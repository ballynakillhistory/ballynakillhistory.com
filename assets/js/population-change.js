// Population-change choropleth: pick any two census years and every townland in the civil
// parish is coloured by how its population changed between them. Reads the shared
// assets/data/census.json (population + houses per townland per census year, exported from
// the population_analysis.census_population table) and joins it to the shared
// assets/data/boundaries.json by townland name.
//
// The class breaks and colours mirror the "Population Change" layers in the QGIS census
// project so the web map and the desktop maps read the same way.

const YEARS_LABEL = { from: "From", to: "To" };

// Order here is the legend order. `test` runs on (a, b) = population at the two dates.
const CLASSES = [
  { id: "wiped", label: "Wiped out (−100%)", color: "#a50026", test: (a, b) => a > 0 && b === 0 },
  { id: "severe", label: "Severe decline (75–99%)", color: "#d73027", test: (a, b) => a > 0 && b > 0 && (b - a) / a <= -0.75 },
  { id: "major", label: "Major decline (50–75%)", color: "#f46d43", test: (a, b) => a > 0 && b > 0 && (b - a) / a <= -0.5 && (b - a) / a > -0.75 },
  { id: "moderate", label: "Moderate decline (25–50%)", color: "#fdae61", test: (a, b) => a > 0 && b > 0 && (b - a) / a <= -0.25 && (b - a) / a > -0.5 },
  { id: "mild", label: "Mild decline (0–25%)", color: "#fee08b", test: (a, b) => a > 0 && b > 0 && b < a && (b - a) / a > -0.25 },
  { id: "same", label: "No change", color: "#f7f7f7", test: (a, b) => a > 0 && a === b },
  { id: "grew1", label: "Slight growth (0–25%)", color: "#a6d96a", test: (a, b) => a > 0 && b > a && (b - a) / a <= 0.25 },
  { id: "grew2", label: "Moderate growth (25–50%)", color: "#66bd63", test: (a, b) => a > 0 && b > a && (b - a) / a > 0.25 && (b - a) / a <= 0.5 },
  { id: "grew3", label: "Strong growth (50–100%)", color: "#1a9850", test: (a, b) => a > 0 && b > a && (b - a) / a > 0.5 && (b - a) / a <= 1 },
  // includes townlands that were empty at the first date and populated at the second,
  // since a percentage from zero is undefined
  { id: "grew4", label: "More than doubled (100%+)", color: "#006837", test: (a, b) => b > a && (a === 0 || (b - a) / a > 1) },
  { id: "empty", label: "Uninhabited at both dates", color: "#bdbdbd", test: (a, b) => a === 0 && b === 0 },
];

function classOf(a, b) {
  return CLASSES.find((c) => c.test(a, b));
}

const fmt = (n) => n.toLocaleString("en-IE");
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));

function pctText(a, b) {
  if (a === 0) return b === 0 ? "–" : "new";
  const pct = ((b - a) / a) * 100;
  return (pct > 0 ? "+" : pct < 0 ? "−" : "") + Math.abs(pct).toFixed(0) + "%";
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

async function loadData() {
  const [censusRes, boundariesRes] = await Promise.all([
    fetch("../../assets/data/census.json"),
    fetch("../../assets/data/boundaries.json"),
  ]);
  if (!censusRes.ok || !boundariesRes.ok) {
    throw new Error(censusRes.statusText || boundariesRes.statusText);
  }
  return { census: await censusRes.json(), boundaries: await boundariesRes.json() };
}

function readHash(years) {
  const m = /^#(\d{4})-(\d{4})$/.exec(location.hash);
  if (m && years.includes(+m[1]) && years.includes(+m[2]) && +m[1] < +m[2]) {
    return [+m[1], +m[2]];
  }
  return [years[0], years[years.length - 1]];
}

function yearSelect(id, labelText, years) {
  const select = el("select", { id });
  years.forEach((y) => select.append(el("option", { value: y, text: y })));
  return { select, wrap: el("label", { for: id }, labelText, select) };
}

async function init(root) {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    root.textContent = "Sorry, the population data could not be loaded.";
    return;
  }
  const { census, boundaries } = data;
  const years = census.years;
  const idx = (y) => years.indexOf(y);

  const controls = document.getElementById("pc-controls");
  const summary = document.getElementById("pc-summary");
  const legend = document.getElementById("pc-legend");
  const tableBody = document.querySelector("#pc-table tbody");
  const tableHead = document.querySelector("#pc-table thead");
  const tableCaption = document.querySelector("#pc-table caption");

  const from = yearSelect("pc-from", YEARS_LABEL.from, years);
  const to = yearSelect("pc-to", YEARS_LABEL.to, years);
  controls.append(from.wrap, to.wrap);

  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const map = L.map(root, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 1 });
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  ).addTo(map);
  root.addEventListener("click", () => map.scrollWheelZoom.enable());
  root.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());

  // one shared tooltip for hover-capable devices. Leaflet skips mouseout while the map is
  // being dragged, so the hovered shape is tracked here and cleared whenever the pointer
  // is no longer over it, leaves the map, or the map starts moving.
  // permanent: Leaflet closes ordinary tooltips on any map click, which dismissed the hover
  // tooltip when the visitor clicked the townland; closing is handled below instead
  const tooltip = L.tooltip({ permanent: true });
  let hovered = null;
  let dragging = false;
  function clearHover() {
    if (hovered) hovered.setStyle({ weight: 1, color: "#333" });
    hovered = null;
    map.closeTooltip(tooltip);
  }
  map.on("movestart zoomstart", clearHover);
  // polygons slide under a stationary cursor while panning and fire mouseover; ignore those
  map.on("dragstart", () => (dragging = true));
  map.on("dragend", () => (dragging = false));
  map.on("mousemove", (e) => {
    if (hovered && e.originalEvent.target !== hovered.getElement()) clearHover();
  });
  root.addEventListener("mouseleave", clearHover);

  const layerByName = new Map();
  const geo = L.geoJSON(boundaries, {
    style: () => ({ color: "#333", weight: 1, fillOpacity: 0.85 }),
    onEachFeature: (feature, layer) => {
      layerByName.set(feature.properties.name, layer);
      // hover-capable devices get a follow-the-cursor tooltip; touch devices get a tap
      // popup. A tap on a phone fires an emulated hover as well as the click, so binding
      // both showed two boxes at once.
      const highlight = () => layer.setStyle({ weight: 3, color: "#fff" });
      const unhighlight = () => layer.setStyle({ weight: 1, color: "#333" });
      if (canHover) {
        // Driven by hand rather than layer.bindTooltip: Leaflet opens bound tooltips on
        // *click* whenever the browser reports touch support (touchscreen laptops, some
        // desktops), and nothing closes them, so click-dragging the map left one stuck open.
        layer.on("mouseover", (e) => {
          if (dragging) return;
          if (hovered && hovered !== layer) clearHover();
          hovered = layer;
          highlight();
          tooltip.setContent(layer.pcContent()).setLatLng(e.latlng);
          map.openTooltip(tooltip);
        });
        layer.on("mousemove", (e) => {
          if (!dragging && hovered === layer) tooltip.setLatLng(e.latlng);
        });
        layer.on("mouseout", () => {
          if (hovered === layer) clearHover();
        });
      } else {
        layer.on("popupopen", highlight);
        layer.on("popupclose", unhighlight);
      }
    },
  }).addTo(map);
  map.fitBounds(geo.getBounds());

  let sortKey = "name";
  let sortDir = 1;
  let rows = [];

  function popupFor(row, yearA, yearB) {
    return el(
      "div",
      { class: "pc-popup" },
      el("strong", { text: row.name }),
      el("div", { text: `${yearA}: ${fmt(row.a)} people, ${row.ha} houses` }),
      el("div", { text: `${yearB}: ${fmt(row.b)} people, ${row.hb} houses` }),
      el("div", { text: `Change: ${signed(row.b - row.a)} (${pctText(row.a, row.b)})` }),
      el("div", { class: "pc-popup-class", text: row.cls.label }),
    );
  }

  function renderTable(yearA, yearB) {
    const keyed = {
      name: (r) => r.name,
      a: (r) => r.a,
      b: (r) => r.b,
      diff: (r) => r.b - r.a,
      // townlands with no starting population have no percentage; sort them after the rest
      pct: (r) => (r.a === 0 ? (r.b > 0 ? Infinity : 0) : (r.b - r.a) / r.a),
    }[sortKey];
    const sorted = [...rows].sort((x, y) => {
      const kx = keyed(x);
      const ky = keyed(y);
      const c = typeof kx === "string" ? kx.localeCompare(ky) : kx - ky;
      return (c || x.name.localeCompare(y.name)) * sortDir;
    });
    tableCaption.textContent = `Population of every townland, ${yearA} and ${yearB}`;
    tableHead.replaceChildren(
      el(
        "tr",
        {},
        ...[
          ["name", "Townland"],
          ["a", String(yearA)],
          ["b", String(yearB)],
          ["diff", "Change"],
          ["pct", "%"],
        ].map(([key, text]) => {
          const th = el("th", { scope: "col" });
          const btn = el("button", { type: "button", class: "pc-sort", text });
          btn.addEventListener("click", () => {
            sortDir = sortKey === key ? -sortDir : 1;
            sortKey = key;
            renderTable(yearA, yearB);
          });
          th.setAttribute("aria-sort", sortKey === key ? (sortDir === 1 ? "ascending" : "descending") : "none");
          th.append(btn);
          return th;
        }),
      ),
    );
    tableBody.replaceChildren(
      ...sorted.map((r) => {
        const swatch = el("span", { class: "pc-swatch", title: r.cls.label });
        swatch.style.background = r.cls.color;
        return el(
          "tr",
          {},
          el("td", {}, swatch, r.name),
          el("td", { text: fmt(r.a) }),
          el("td", { text: fmt(r.b) }),
          el("td", { text: signed(r.b - r.a) }),
          el("td", { text: pctText(r.a, r.b) }),
        );
      }),
    );
  }

  function render() {
    // an open popup or tooltip shows the previous years' figures, so close it
    map.closePopup();
    clearHover();
    const yearA = +from.select.value;
    const yearB = +to.select.value;
    const ia = idx(yearA);
    const ib = idx(yearB);

    // only offer valid orderings: "from" must be earlier than "to"
    [...from.select.options].forEach((o) => (o.disabled = +o.value >= yearB));
    [...to.select.options].forEach((o) => (o.disabled = +o.value <= yearA));

    rows = Object.entries(census.townlands).map(([name, t]) => ({
      name,
      a: t.pop[ia],
      b: t.pop[ib],
      ha: t.houses[ia],
      hb: t.houses[ib],
      cls: classOf(t.pop[ia], t.pop[ib]),
    }));

    rows.forEach((row) => {
      const layer = layerByName.get(row.name);
      if (!layer) return;
      layer.setStyle({ fillColor: row.cls.color });
      layer.unbindPopup();
      layer.pcContent = () => popupFor(row, yearA, yearB);
      if (!canHover) layer.bindPopup(layer.pcContent());
    });

    const totalA = rows.reduce((s, r) => s + r.a, 0);
    const totalB = rows.reduce((s, r) => s + r.b, 0);
    const housesA = rows.reduce((s, r) => s + r.ha, 0);
    const housesB = rows.reduce((s, r) => s + r.hb, 0);
    summary.textContent =
      `Whole parish: ${fmt(totalA)} people in ${yearA}, ${fmt(totalB)} in ${yearB} ` +
      `(${signed(totalB - totalA)}, ${pctText(totalA, totalB)}). ` +
      `Houses: ${fmt(housesA)} to ${fmt(housesB)}.`;

    legend.replaceChildren(
      ...CLASSES.map((c) => {
        const n = rows.filter((r) => r.cls === c).length;
        const swatch = el("span", { class: "pc-swatch" });
        swatch.style.background = c.color;
        return el("li", { class: n ? "" : "pc-legend-empty" }, swatch, `${c.label} `, el("span", { class: "pc-count", text: `${n}` }));
      }),
    );

    renderTable(yearA, yearB);
    history.replaceState(null, "", `#${yearA}-${yearB}`);
    root.setAttribute(
      "aria-label",
      `Map of population change in each townland of Ballynakill civil parish between ${yearA} and ${yearB}. ${summary.textContent}`,
    );
  }

  [from.select.value, to.select.value] = readHash(years);
  from.select.addEventListener("change", render);
  to.select.addEventListener("change", render);
  window.addEventListener("hashchange", () => {
    [from.select.value, to.select.value] = readHash(years);
    render();
  });
  render();
}

document.querySelectorAll(".population-change-map").forEach(init);
