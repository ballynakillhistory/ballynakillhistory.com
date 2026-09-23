// Renders an interactive population-over-time chart into every
// .townland-population-chart[data-townland] element on the page, reading
// the shared assets/data/population.json. Mirrors the loading pattern used
// by townland-map.js (one shared fetch, one script for every townland page).

const W = 640;
const H = 220;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

function fmtChange(first, last) {
  if (first === 0) {
    return last > 0 ? "new" : null;
  }
  const pct = ((last - first) / first) * 100;
  const sign = pct >= 0 ? "+" : "−";
  return sign + Math.abs(pct).toFixed(0) + "%";
}

function buildChart(container, years, values) {
  const max = Math.max(...values);
  const scaleMax = max === 0 ? 1 : max;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const x = (i) => PAD_L + (i / (years.length - 1)) * plotW;
  const y = (v) => PAD_T + (1 - v / scaleMax) * plotH;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "population-chart-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // gridlines + y-axis labels (0, half, max)
  const gridSteps = max === 0 ? [0] : [0, 0.5, 1];
  gridSteps.forEach((frac) => {
    const val = Math.round(scaleMax * frac);
    const gy = y(val);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", PAD_L);
    line.setAttribute("x2", W - PAD_R);
    line.setAttribute("y1", gy);
    line.setAttribute("y2", gy);
    line.setAttribute("class", "chart-grid");
    svg.appendChild(line);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", PAD_L - 8);
    label.setAttribute("y", gy + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "chart-axis-label");
    label.textContent = val;
    svg.appendChild(label);
  });

  // x-axis year labels (skip alternating labels on narrow screens via CSS class)
  years.forEach((yr, i) => {
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x(i));
    label.setAttribute("y", H - PAD_B + 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "chart-axis-label chart-year-label");
    label.textContent = yr;
    svg.appendChild(label);
  });

  // line path
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", `M ${points}`);
  path.setAttribute("class", "chart-line");
  svg.appendChild(path);

  // area fill under the line
  const areaD = `M ${x(0)},${y(0)} L ${points} L ${x(values.length - 1)},${y(0)} Z`;
  const area = document.createElementNS(svgNS, "path");
  area.setAttribute("d", areaD);
  area.setAttribute("class", "chart-area");
  svg.insertBefore(area, svg.firstChild);

  // dots + larger invisible hit targets for hover/tap
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;

  values.forEach((v, i) => {
    const cx = x(i);
    const cy = y(v);

    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("cx", cx);
    hit.setAttribute("cy", cy);
    hit.setAttribute("r", 11);
    hit.setAttribute("class", "chart-hit");
    svg.appendChild(hit);

    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    dot.setAttribute("r", 3);
    dot.setAttribute("class", "chart-dot");
    svg.appendChild(dot);

    function showTooltip() {
      const rect = svg.getBoundingClientRect();
      const scaleX = rect.width / W;
      const scaleY = rect.height / H;
      tooltip.style.left = cx * scaleX + "px";
      tooltip.style.top = cy * scaleY + "px";
      tooltip.textContent = `${years[i]}: ${v.toLocaleString()}`;
      tooltip.hidden = false;
    }
    function hideTooltip() {
      tooltip.hidden = true;
    }

    hit.addEventListener("mouseenter", showTooltip);
    hit.addEventListener("mousemove", showTooltip);
    hit.addEventListener("mouseleave", hideTooltip);
    hit.addEventListener("focus", showTooltip);
    hit.addEventListener("blur", hideTooltip);
    hit.addEventListener("touchstart", showTooltip, { passive: true });
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("role", "img");
    hit.setAttribute("aria-label", `${years[i]}: ${v.toLocaleString()} people`);
  });

  const wrap = document.createElement("div");
  wrap.className = "population-chart-wrap";
  wrap.appendChild(svg);
  wrap.appendChild(tooltip);
  container.appendChild(wrap);

  // summary line with the overall change
  const first = values[0];
  const last = values[values.length - 1];
  const change = fmtChange(first, last);
  const summary = document.createElement("p");
  summary.className = "population-chart-summary";
  if (max === 0) {
    summary.textContent = "No residents recorded in any census, 1841–1926.";
  } else if (change === null) {
    summary.textContent = `${first.toLocaleString()} in ${years[0]}, none recorded by ${years[years.length - 1]}.`;
  } else {
    summary.innerHTML = `${first.toLocaleString()} in ${years[0]} → ${last.toLocaleString()} in ${years[years.length - 1]} <strong>(${change})</strong>`;
  }
  container.appendChild(summary);
}

async function initPopulationCharts() {
  const els = document.querySelectorAll(".townland-population-chart");
  if (!els.length) return;

  let data;
  try {
    const res = await fetch("../../assets/data/population.json");
    data = await res.json();
  } catch (err) {
    return;
  }

  els.forEach((el) => {
    const slug = el.dataset.townland;
    const values = data.townlands[slug];
    if (!values) return;
    buildChart(el, data.years, values);
  });
}

initPopulationCharts();
