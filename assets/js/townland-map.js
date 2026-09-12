const FIXED_COLORS = {
  houses: "#d1372b",
  buildings: "#2b6bd1",
};

// deterministic categorical palette for placename types — same type always gets the same
// colour across every townland page, since the palette is chosen by hash, not by page order
const TYPE_PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}

function colorFor(properties) {
  if (properties.layer === "placenames") {
    return hashColor(properties.category || "");
  }
  return FIXED_COLORS[properties.layer] || "#666";
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// run after esc() — the notes field sometimes cites a source as a plain URL, which should
// be a clickable link rather than long unbroken text
function linkify(escapedText) {
  return escapedText.replace(
    /https?:\/\/[^\s<>")]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`,
  );
}

function popupHtml(properties) {
  const p = properties;
  let html = `<strong>${esc(p.name)}</strong>`;
  if (p.category) html += `<br><span class="map-popup-category">${esc(p.category)}</span>`;
  if (p.notes) html += `<p>${linkify(esc(p.notes).replace(/\n/g, "<br>"))}</p>`;
  return html;
}

const LABEL_GAP = 8; // px between a point's edge and its label

// Leaflet applies `offset` as-is regardless of tooltip direction — it does NOT flip its sign
// for 'left', so a positive x offset (correct for pushing a 'right' label away from the point)
// instead pulls a 'left' label back toward/over the point. Each direction needs its own sign.
function offsetFor(dir) {
  return dir === "left" ? [-LABEL_GAP, 0] : [LABEL_GAP, 0];
}

// simple side-declutter: pairwise-check rendered label boxes, flip conflicting labels to the
// other side of their point until no (or fewer) pairs overlap. Panning doesn't change relative
// overlap (a rigid translation), so this only needs to re-run on zoom, not on every pan.
function declutterLabels(items) {
  function rectOf(item) {
    const el = item.marker.getTooltip()?.getElement();
    return el ? el.getBoundingClientRect() : null;
  }
  function overlaps(a, b) {
    return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
  }
  function applyDirection(item) {
    const tooltip = item.marker.getTooltip();
    if (tooltip && tooltip.options.direction !== item.dir) {
      tooltip.options.direction = item.dir;
      tooltip.options.offset = offsetFor(item.dir);
      item.marker.closeTooltip();
      item.marker.openTooltip();
    }
  }

  items.forEach((item) => applyDirection(item));

  for (let pass = 0; pass < 4; pass++) {
    const rects = items.map(rectOf);
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!rects[i] || !rects[j]) continue;
        if (items[i].dir === items[j].dir && overlaps(rects[i], rects[j])) {
          items[j].dir = items[j].dir === "right" ? "left" : "right";
          changed = true;
        }
      }
    }
    items.forEach((item) => applyDirection(item));
    if (!changed) break;
  }
}

async function initTownlandMap(el) {
  const dataUrl = el.dataset.src;
  let data;
  try {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch (err) {
    el.textContent = "Map data could not be loaded.";
    return;
  }

  const map = L.map(el, { scrollWheelZoom: false });
  map.invalidateSize();

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  ).addTo(map);

  // don't trap page-scroll: only zoom on scroll once the visitor has clicked in
  el.addEventListener("click", () => map.scrollWheelZoom.enable());
  el.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());

  const boundsList = [];

  if (data.boundary) {
    const boundaryLayer = L.geoJSON(data.boundary, {
      style: { color: "#e8890c", weight: 2, fill: false },
    }).addTo(map);
    boundsList.push(boundaryLayer.getBounds());
  }

  const labelItems = [];

  const pointsLayer = L.geoJSON(data.points, {
    pointToLayer: (feature, latlng) => {
      const color = colorFor(feature.properties);
      return L.circleMarker(latlng, {
        radius: 6,
        color: "#fff",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.9,
      });
    },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(popupHtml(feature.properties));
      layer.bindTooltip(esc(feature.properties.name), {
        permanent: true,
        direction: "right",
        offset: offsetFor("right"),
        className: "point-label",
      });
      labelItems.push({ marker: layer, dir: "right" });
    },
  }).addTo(map);
  boundsList.push(pointsLayer.getBounds());

  const combined = boundsList.reduce(
    (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast())),
    null,
  );
  if (combined) map.fitBounds(combined, { padding: [20, 20] });

  map.whenReady(() => setTimeout(() => declutterLabels(labelItems), 0));
  map.on("zoomend", () => declutterLabels(labelItems));

  const legendEntries = [];
  const seenTypes = new Set();
  data.points.features.forEach((f) => {
    const p = f.properties;
    const key = p.layer === "placenames" ? `type:${p.category}` : `layer:${p.layer}`;
    if (seenTypes.has(key)) return;
    seenTypes.add(key);
    const label =
      p.layer === "placenames"
        ? p.category || "(uncategorised)"
        : p.layer === "houses"
          ? "house"
          : "building";
    legendEntries.push({ label: label.toLowerCase(), color: colorFor(p) });
  });
  legendEntries.sort((a, b) => a.label.localeCompare(b.label));

  if (legendEntries.length) {
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML = legendEntries
        .map((e) => `<span><i style="background:${e.color}"></i>${esc(e.label)}</span>`)
        .join("");
      return div;
    };
    legend.addTo(map);
  }
}

document.querySelectorAll(".townland-map[data-src]").forEach(initTownlandMap);
