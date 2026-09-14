const FIXED_COLORS = {
  houses: "#db1e2a",
  buildings: "#0000ff",
};

// colours copied exactly from the categorized renderer on the "placenames" layer in the
// project's own QGIS "Online" group — keep this in sync with that layer's style, not invented
const TYPE_COLORS = {
  "bog": "#d844ef",
  "bridge": "#d07e92",
  "brow, slope, hillside": "#2525e3",
  "cave(s), souterrain(s)": "#d4ac0c",
  "creek": "#82e898",
  "crossroads": "#397eee",
  "enclosure": "#cb31aa",
  "field": "#88db3a",
  "fort": "#3c92d8",
  "gap": "#c84393",
  "gate": "#56efad",
  "graveyard, cemetary, burial ground": "#755cf0",
  "hamlet (small group of houses in a rural area)": "#31e8d9",
  "hill or hills": "#9ae577",
  "hole": "#845bcf",
  "hollow": "#4cda51",
  "house": "#efa76d",
  "island or archipelago": "#0f3bed",
  "lake or lakes": "#6ddc5b",
  "man-made feature": "#d25523",
  "marsh": "#9ad02f",
  "mass path": "#68b0ca",
  "mass rock": "#b4cc3e",
  "other": "#dc7dd7",
  "point, tip": "#df1f6f",
  "river": "#d0424c",
  "road": "#984fdd",
  "rock or rocks": "#bb5ce4",
  "stream": "#2ecfe1",
  "sub-townland": "#cc9028",
  "tree or bush": "#ee4b39",
  "well": "#42dc7d",
  "wood": "#edeb58",
  "minor feature": "#9228b8",
  "monument": "#27dda0",
  "mountain or mountain range": "#60c665",
  "country lane, boreen": "#91502d",
  "forge": "#2d218c",
  "haggard": "#fec645",
  "standing stone or standing stones": "#f4b548",
  "bay": "#77b9d7",
  "patch of ground": "#385b8e",
  "quay, pier, wharf": "#3148ae",
};

function colorFor(properties) {
  if (properties.layer === "placenames") {
    return TYPE_COLORS[properties.category] || "#666";
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

// townlandLabel is passed only when rendering unfiltered (the overview map) — on a
// single-townland page it would just repeat the page's own subject, so it's omitted there.
// Its presence also distinguishes the two popup styles: the overview map mixes points from
// many townlands, so its fields are labelled (except name); a single-townland page's popup
// stays unlabelled since "Type: field" etc. is less needed alongside the page's own tables.
function popupHtml(properties, townlandLabel) {
  const p = properties;
  let html = `<strong>${esc(p.name)}</strong>`;
  if (townlandLabel) {
    html += `<br><span class="map-popup-townland">Townland: ${esc(townlandLabel)}</span>`;
    if (p.category) html += `<br><span class="map-popup-category">Type: ${esc(p.category)}</span>`;
    if (p.notes) html += `<p>Notes: ${linkify(esc(p.notes).replace(/\n/g, "<br>"))}</p>`;
  } else {
    if (p.category) html += `<br><span class="map-popup-category">${esc(p.category)}</span>`;
    if (p.notes) html += `<p>${linkify(esc(p.notes).replace(/\n/g, "<br>"))}</p>`;
  }
  return html;
}

const LABEL_GAP = 8; // px between a point's edge and its label

// Leaflet applies `offset` as-is regardless of tooltip direction — it does NOT flip its sign
// for 'left', so a positive x offset (correct for pushing a 'right' label away from the point)
// instead pulls a 'left' label back toward/over the point. Each direction needs its own sign.
function offsetFor(dir) {
  return dir === "left" ? [-LABEL_GAP, 0] : [LABEL_GAP, 0];
}

// Labels are shown on a "does it fit" basis rather than a fixed zoom threshold: at each zoom
// level we place labels one at a time in priority order, skipping (hiding) any whose box would
// overlap one already placed. Zooming in spreads points apart in pixel-space, so more labels
// pass the fit test on their own — no manual threshold to tune. Priority favours orienting,
// larger-scale features (lakes, hills, sub-townlands) so those are the ones that survive first
// when zoomed out and everything can't fit yet.
const TYPE_PRIORITY = {
  "sub-townland": 0,
  "lake or lakes": 0,
  "hill or hills": 0,
  wood: 0,
};

function priorityFor(properties) {
  if (properties.layer === "houses") return 3;
  if (properties.layer === "buildings") return 4;
  return TYPE_PRIORITY[properties.category] ?? 2;
}

function overlaps(a, b) {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

// how many zoom levels past the initial fit-to-townland view before every label is forced
// to show — a hard guarantee on top of the collision-avoidance, so two points that are
// genuinely only a few metres apart (and so never fully separate in pixel-space at any
// sane zoom) don't end up with a permanently-hidden label
const FULL_LABEL_ZOOM_DELTA = 2;

function declutterLabels(map, items, initialZoom) {
  const forceAll = map.getZoom() >= initialZoom + FULL_LABEL_ZOOM_DELTA;
  // measure each label's natural size once (before any hiding) — content/font never changes,
  // so a fixed width/height can be reused for every future placement calculation
  items.forEach((item) => {
    if (item.size) return;
    const el = item.marker.getTooltip()?.getElement();
    if (el) item.size = { width: el.offsetWidth, height: el.offsetHeight };
  });

  function candidateRect(item, dir) {
    const pt = map.latLngToContainerPoint(item.marker.getLatLng());
    const { width, height } = item.size;
    const top = pt.y - height / 2;
    const left = dir === "left" ? pt.x - LABEL_GAP - width : pt.x + LABEL_GAP;
    return { left, top, right: left + width, bottom: top + height };
  }

  function show(item, dir) {
    const tooltip = item.marker.getTooltip();
    if (tooltip.options.direction !== dir) {
      tooltip.options.direction = dir;
      tooltip.options.offset = offsetFor(dir);
      item.marker.closeTooltip();
      item.marker.openTooltip();
    }
    tooltip.getElement().style.display = "";
  }

  function hide(item) {
    item.marker.getTooltip()?.getElement()?.style.setProperty("display", "none");
  }

  const ordered = [...items].sort(
    (a, b) => priorityFor(a.marker.feature.properties) - priorityFor(b.marker.feature.properties),
  );

  const accepted = [];
  ordered.forEach((item) => {
    if (!item.size) return;
    const rightRect = candidateRect(item, "right");
    const leftRect = candidateRect(item, "left");
    const rightFree = !accepted.some((r) => overlaps(r, rightRect));
    const leftFree = !accepted.some((r) => overlaps(r, leftRect));
    if (rightFree) {
      show(item, "right");
      accepted.push(rightRect);
    } else if (leftFree) {
      show(item, "left");
      accepted.push(leftRect);
    } else if (forceAll) {
      // both sides collide, but past the guarantee threshold every label shows regardless —
      // still pick 'right' for consistency, just accept the visual overlap
      show(item, "right");
      accepted.push(rightRect);
    } else {
      hide(item);
    }
  });
}

// Points and boundaries for every published townland live in two shared files (not one
// file per townland) so there is a single source of truth for both the per-townland pages
// and the combined overview map. A page opts into just its own townland via data-townland;
// the overview map omits that attribute and gets everything.
async function loadSharedData() {
  const [pointsRes, boundariesRes] = await Promise.all([
    fetch("../../assets/data/points.json"),
    fetch("../../assets/data/boundaries.json"),
  ]);
  if (!pointsRes.ok || !boundariesRes.ok) {
    throw new Error(pointsRes.statusText || boundariesRes.statusText);
  }
  const [points, boundaries] = await Promise.all([pointsRes.json(), boundariesRes.json()]);
  return { points, boundaries };
}

async function initTownlandMap(el) {
  const townland = el.dataset.townland || null;
  let points, boundaries;
  try {
    ({ points, boundaries } = await loadSharedData());
  } catch (err) {
    el.textContent = "Map data could not be loaded.";
    return;
  }

  const data = {
    points: {
      type: "FeatureCollection",
      features: townland
        ? points.features.filter((f) => f.properties.townland === townland)
        : points.features,
    },
    boundaries: townland
      ? boundaries.features.filter((f) => f.properties.townland === townland)
      : boundaries.features,
  };

  // fractional zoom so fitBounds can land on the true best-fit level instead of always
  // rounding down to the next whole zoom (which overshoots badly on small/oddly-shaped
  // townlands, e.g. a tall narrow bounding box) — zoomDelta keeps the +/- buttons at whole steps
  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 1 });
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

  // fullscreen via the native Fullscreen API rather than a plugin — the browser already
  // provides an "Esc to exit" affordance for free, the button just mirrors that as a click target
  if (el.requestFullscreen) {
    const fullscreenControl = L.control({ position: "topright" });
    fullscreenControl.onAdd = () => {
      const container = L.DomUtil.create("div", "leaflet-bar map-fullscreen-control");
      const button = L.DomUtil.create("a", "", container);
      button.href = "#";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", "Toggle fullscreen map");
      button.title = "View fullscreen";
      button.innerHTML = "⛶";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, "click", (e) => {
        e.preventDefault();
        if (document.fullscreenElement === el) {
          document.exitFullscreen().catch(() => {});
        } else {
          el.requestFullscreen().catch(() => {});
        }
      });
      el.addEventListener("fullscreenchange", () => {
        const isFullscreen = document.fullscreenElement === el;
        button.title = isFullscreen ? "Exit fullscreen" : "View fullscreen";
        button.innerHTML = isFullscreen ? "✕" : "⛶";
        map.invalidateSize();
      });
      return container;
    };
    fullscreenControl.addTo(map);
  }

  // the overview map is a bare full-viewport page (no site header/nav), so it needs its
  // own way back in rather than relying on the browser back button
  if (!townland) {
    const backControl = L.control({ position: "topleft" });
    backControl.onAdd = () => {
      const container = L.DomUtil.create("div", "map-back-link");
      const link = L.DomUtil.create("a", "", container);
      link.href = "../";
      link.textContent = "← Placenames Project";
      L.DomEvent.disableClickPropagation(container);
      return container;
    };
    backControl.addTo(map);
  }

  const boundsList = [];

  // used only in overview mode (townland === null) to label points with which townland
  // they belong to, since a single point feature only carries the townland's slug
  const townlandNames = new Map(boundaries.features.map((f) => [f.properties.townland, f.properties.name]));

  if (data.boundaries.length) {
    // In overview mode boundaries.json carries every townland in the civil parish, not just
    // published ones (so the map shows the whole area, points or not) — dim/dash the ones
    // without a page yet so it's clear at a glance which is which.
    const boundaryLayer = L.geoJSON(
      { type: "FeatureCollection", features: data.boundaries },
      {
        style: (feature) =>
          feature.properties.published
            ? { color: "#e8890c", weight: 2, fill: false }
            : { color: "#999", weight: 1, dashArray: "4,4", fill: false },
        onEachFeature: townland
          ? undefined
          : (feature, layer) => {
              layer.bindTooltip(esc(feature.properties.name), { sticky: true });
              if (feature.properties.published) {
                layer.on("click", () => {
                  window.location.href = `../${feature.properties.townland}/`;
                });
              }
            },
      },
    ).addTo(map);
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
      const townlandLabel = townland ? null : townlandNames.get(feature.properties.townland);
      layer.bindPopup(popupHtml(feature.properties, townlandLabel));
      layer.bindTooltip(esc(feature.properties.name), {
        permanent: true,
        direction: "right",
        offset: offsetFor("right"),
        className: "point-label",
      });
      labelItems.push({ marker: layer });
    },
  }).addTo(map);
  boundsList.push(pointsLayer.getBounds());

  const combined = boundsList.reduce(
    (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast())),
    null,
  );
  if (combined) map.fitBounds(combined, { padding: [40, 40] });
  const initialZoom = map.getZoom();

  map.whenReady(() => setTimeout(() => declutterLabels(map, labelItems, initialZoom), 0));
  map.on("zoomend", () => declutterLabels(map, labelItems, initialZoom));

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
      // collapsed by default on narrow (mobile) viewports, where the full list eats too much
      // of the map — open by default on wider ones, where it was never a space problem
      const startCollapsed = window.matchMedia("(max-width: 600px)").matches;
      if (startCollapsed) div.classList.add("collapsed");
      div.innerHTML =
        '<button type="button" class="map-legend-toggle">Legend</button>' +
        '<div class="map-legend-items">' +
        legendEntries
          .map((e) => `<span><i style="background:${e.color}"></i>${esc(e.label)}</span>`)
          .join("") +
        "</div>";
      div.querySelector(".map-legend-toggle").addEventListener("click", () => {
        div.classList.toggle("collapsed");
      });
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    legend.addTo(map);
  }
}

document.querySelectorAll(".townland-map").forEach(initTownlandMap);
