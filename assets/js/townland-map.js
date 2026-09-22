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
  return escapedText.replace(/https?:\/\/[^\s<>")]+/g, (url) => {
    let host = "link";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    return `<a href="${url}" target="_blank" rel="noopener" data-goatcounter-click="ext-${host}">${url}</a>`;
  });
}

// GoatCounter loads async from the <head> and may be blocked, so every call is guarded
function track(path, title) {
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path, title, event: true });
  }
}

// townlandLabel is passed only when rendering unfiltered (the overview map) — on a
// single-townland page it would just repeat the page's own subject, so that one line is
// omitted there; Type and Notes are labelled the same way on every page.
function popupHtml(properties, townlandLabel) {
  const p = properties;
  let html = `<strong>${esc(p.name)}</strong>`;
  if (townlandLabel) {
    html += `<br><span class="map-popup-townland"><strong>Townland:</strong> ${esc(townlandLabel)}</span>`;
  }
  if (p.category) html += `<br><span class="map-popup-category"><strong>Type:</strong> ${esc(p.category)}</span>`;
  if (p.notes) html += `<p><strong>Notes</strong><br>${linkify(esc(p.notes).replace(/\n/g, "<br>"))}</p>`;
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

// A narrow phone screen has to fit the same geographic area into far fewer pixels than a
// desktop one, so Leaflet's fitBounds lands on a lower initial zoom there — on a 390px phone
// vs. a 1850px desktop that's routinely a ~2 zoom-level gap. Measuring FULL_LABEL_ZOOM_DELTA
// from each map's own initial zoom meant "zoomed in 2 steps" corresponded to a much smaller
// real-world scale on desktop than on mobile, so the phone forced every label to show while
// a much wider area (still close to the whole parish) was on screen. Normalising the initial
// zoom against a reference container width first keeps the threshold tied to real-world
// ground scale rather than to whatever width the visitor's screen happens to be.
const REFERENCE_CONTAINER_WIDTH = 1200; // matches --content-width, an arbitrary but fixed reference

function declutterLabels(map, items, initialZoom) {
  const normalizedInitialZoom =
    initialZoom + Math.log2(REFERENCE_CONTAINER_WIDTH / map.getSize().x);
  const forceAll = map.getZoom() >= normalizedInitialZoom + FULL_LABEL_ZOOM_DELTA;

  // Re-running this over the full point set (600+ on the overview map) on every zoom step is
  // what made zooming feel laggy — most of them are off-screen at any given time, and zooming
  // in should mean less work, not the same amount. Only labels inside the current viewport
  // (plus a small buffer) get measured/positioned; anything outside is hidden and left alone
  // until it's back in view — Leaflet keeps its lat/lng position correct regardless.
  const bounds = map.getBounds().pad(0.25);
  const visible = [];
  items.forEach((item) => {
    if (bounds.contains(item.marker.getLatLng())) {
      visible.push(item);
    } else {
      hide(item);
    }
  });

  // measure each label's natural size once (before any hiding) — content/font never changes,
  // so a fixed width/height can be reused for every future placement calculation
  visible.forEach((item) => {
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
    // A label that was hidden (panned off-screen, then back into view) was hidden by a plain
    // CSS display:none, not by Leaflet's own closeTooltip — so its last known screen position
    // can go stale while hidden. Skipping the reopen there (as this used to do whenever the
    // direction happened to match) left it rendered at that stale spot, offset from the point,
    // until the next zoom forced a fresh reopen anyway. Anything just transitioning back into
    // view always gets a real close+reopen; only an already-visible, unchanged label skips it.
    if (tooltip.options.direction !== dir || item.wasHidden) {
      tooltip.options.direction = dir;
      tooltip.options.offset = offsetFor(dir);
      item.marker.closeTooltip();
      item.marker.openTooltip();
    }
    tooltip.getElement().style.display = "";
    item.wasHidden = false;
  }

  function hide(item) {
    item.marker.getTooltip()?.getElement()?.style.setProperty("display", "none");
    item.wasHidden = true;
  }

  const ordered = [...visible].sort(
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

// Townland-boundary labels (overview map only) use a simpler rule than declutterLabels above:
// a centred label doesn't have a left/right choice to try, so instead of pairwise collision
// avoidance, just show it once the townland's own on-screen footprint is big enough to hold
// it. At the parish-wide initial view, 144 labels pairwise-overlap badly (small townlands
// packed close together); this thins them out and fills in as you zoom into a given area.
//
// Reads (offsetWidth/getBounds) and writes (open/closeTooltip) are done in two separate
// passes, not interleaved per item — mixing them in one loop over 144 items forces a
// synchronous layout reflow on every single read, once per item, which is what made this
// noticeably janky on zoom before this was split.
function declutterTownlandLabels(map, items) {
  items.forEach((item) => {
    if (!item.bounds) item.bounds = item.layer.getBounds(); // static geometry, cache forever
  });

  // same reasoning as declutterLabels above: skip the townlands nowhere near the current
  // view rather than repositioning all 144 of them on every zoom step
  const bounds = map.getBounds().pad(0.1);
  const visible = [];
  items.forEach((item) => {
    if (bounds.intersects(item.bounds)) {
      visible.push(item);
    } else {
      item.layer.closeTooltip();
    }
  });

  visible.forEach((item) => {
    if (!item.size) {
      const el = item.layer.getTooltip()?.getElement();
      if (el) item.size = { width: el.offsetWidth, height: el.offsetHeight };
    }
  });
  visible.forEach((item) => {
    if (!item.size) return;
    const nw = map.latLngToContainerPoint(item.bounds.getNorthWest());
    const se = map.latLngToContainerPoint(item.bounds.getSouthEast());
    const fits =
      Math.abs(se.x - nw.x) > item.size.width + 12 && Math.abs(se.y - nw.y) > item.size.height + 12;
    if (fits) item.layer.openTooltip();
    else item.layer.closeTooltip();
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
  // canvas rendering is much cheaper than SVG once there are hundreds of circle markers
  // (the overview map has 600+), especially for the redraw Leaflet does on every zoom frame
  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 1, preferCanvas: true });
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

  const townlandLabelItems = [];

  // Fitting the initial view to all 144 boundaries (below) zooms out to the whole civil
  // parish, which is both more zoomed-out than useful and makes the first view of the
  // overview map busier than it needs to be with unpublished-townland labels. Frame the
  // initial view on the published townlands only — the full parish is still there to
  // explore by zooming/panning out, just not what you're dropped into.
  let publishedBoundsOnly = null;

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
              // permanent, not hover-only — the overview map is meant to read as a labelled
              // parish map. Positioned by Leaflet's own polygon-centre logic (direction: "center").
              layer.bindTooltip(esc(feature.properties.name), {
                permanent: true,
                direction: "center",
                className: "townland-label",
              });
              townlandLabelItems.push({ layer });
              if (feature.properties.published) {
                const b = layer.getBounds();
                publishedBoundsOnly = publishedBoundsOnly ? publishedBoundsOnly.extend(b) : b;
              }
            },
      },
    ).addTo(map);
    const fitBoundary = townland ? boundaryLayer.getBounds() : publishedBoundsOnly;
    if (fitBoundary) boundsList.push(fitBoundary);
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
      layer.on("popupopen", () => {
        const where = townlandLabel || townlandNames.get(feature.properties.townland) || feature.properties.townland;
        track("map-point: " + where + " - " + feature.properties.name, feature.properties.name);
        // links inside a popup are created when it opens, so have GoatCounter bind them now
        if (window.goatcounter && window.goatcounter.bind_events) window.goatcounter.bind_events();
      });
      layer.bindTooltip(esc(feature.properties.name), {
        permanent: true,
        direction: "right",
        offset: offsetFor("right"),
        className: "point-label",
      });
      // starts true: the tooltip auto-opened at bind time above, at whatever the default
      // "right" position happened to be — that first real declutter pass should treat it the
      // same as anything else transitioning into view and give it a proper reopen, not assume
      // its position is already correct
      labelItems.push({ marker: layer, wasHidden: true });
    },
  }).addTo(map);
  boundsList.push(pointsLayer.getBounds());

  const combined = boundsList.reduce(
    (acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast())),
    null,
  );
  if (combined) map.fitBounds(combined, { padding: [40, 40] });
  const initialZoom = map.getZoom();

  // "moveend" fires once the view settles after either a zoom or a pan/drag (it covers
  // zoomend too), which matters since the two declutter passes above only consider labels
  // inside the current viewport — panning at a fixed zoom needs to re-run this just as much
  // as zooming does, or newly-panned-into-view points stay unlabelled until the next zoom.
  map.whenReady(() => setTimeout(() => declutterLabels(map, labelItems, initialZoom), 0));
  map.on("moveend", () => declutterLabels(map, labelItems, initialZoom));

  if (townlandLabelItems.length) {
    map.whenReady(() => setTimeout(() => declutterTownlandLabels(map, townlandLabelItems), 0));
    map.on("moveend", () => declutterTownlandLabels(map, townlandLabelItems));
  }

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
