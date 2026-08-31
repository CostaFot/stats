/* Dashboard for CostaFot's Command Palette extensions.
   Reads per-app CSVs (date,github_downloads,store_acquisitions — cumulative)
   from the stats repo's `data` branch at runtime. */

// refs/heads/ keeps the ref unambiguous — the short form (/stats/data/data/…)
// makes raw.githubusercontent.com guess where the ref ends, and it 400s on
// some paths.
const DATA_BASE =
  "https://raw.githubusercontent.com/CostaFot/stats/refs/heads/data/data/";
const SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4"];

const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let apps = [];        // [{slug, name, repo, storeId, color, rows|null}]
let charts = [];      // live Chart instances, destroyed on re-theme

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  lines.shift(); // header
  return lines
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [date, gh, store] = line.split(",");
      return {
        date,
        github: gh === undefined || gh === "" ? null : Number(gh),
        store: store === undefined || store === "" ? null : Number(store),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Cumulative series: a blank cell means "not recorded that day", not zero —
// carry the last known value forward.
function forwardFill(values) {
  let last = null;
  return values.map((v) => (v == null ? last : (last = v)));
}

function lastKnown(rows, key) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][key] != null) return rows[i][key];
  }
  return null;
}

// Per-app combined cumulative series over that app's own dates.
function combinedSeries(rows) {
  const gh = forwardFill(rows.map((r) => r.github));
  const st = forwardFill(rows.map((r) => r.store));
  return rows.map((r, i) =>
    gh[i] == null && st[i] == null ? null : (gh[i] ?? 0) + (st[i] ?? 0)
  );
}

async function loadData() {
  const cfg = await (await fetch("./apps.json")).json();
  const results = await Promise.allSettled(
    cfg.map(async (app) => {
      const res = await fetch(`${DATA_BASE}${app.slug}.csv?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseCsv(await res.text());
    })
  );
  apps = cfg.map((app, i) => ({
    ...app,
    seriesVar: SERIES_VARS[i % SERIES_VARS.length],
    rows: results[i].status === "fulfilled" && results[i].value.length > 0
      ? results[i].value
      : null,
  }));
}

function buildTiles() {
  const live = apps.filter((a) => a.rows);
  const github = live.reduce((s, a) => s + (lastKnown(a.rows, "github") ?? 0), 0);
  const store = live.reduce((s, a) => s + (lastKnown(a.rows, "store") ?? 0), 0);
  const total = github + store;

  // Grand combined series over the union of dates, for the 7-day delta.
  const dates = [...new Set(live.flatMap((a) => a.rows.map((r) => r.date)))].sort();
  const grand = dates.map((d) =>
    live.reduce((sum, a) => {
      const upTo = a.rows.filter((r) => r.date <= d);
      const gh = lastKnown(upTo, "github") ?? 0;
      const st = lastKnown(upTo, "store") ?? 0;
      return sum + gh + st;
    }, 0)
  );
  let delta = null;
  if (dates.length > 1) {
    const lastDate = new Date(dates[dates.length - 1]);
    const cutoff = new Date(lastDate.getTime() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    let ref = 0; // earliest recorded value if nothing predates the cutoff
    for (let i = 0; i < dates.length; i++) if (dates[i] <= cutoff) ref = i;
    delta = grand[grand.length - 1] - grand[ref];
  }

  const tiles = [
    { label: "Total installs", value: fmt(total), note: "all apps, all channels" },
    { label: "GitHub + WinGet", value: fmt(github), note: "release downloads" },
    { label: "Microsoft Store", value: fmt(store), note: "acquisitions" },
    {
      label: "Last 7 days",
      value: delta == null ? "–" : `+${fmt(delta)}`,
      note: delta == null ? "needs more data" : "new installs",
      cls: delta > 0 ? "delta-up" : "",
    },
  ];
  document.getElementById("tiles").innerHTML = tiles
    .map(
      (t) => `
      <div class="card tile">
        <div class="label">${t.label}</div>
        <div class="value ${t.cls || ""}">${t.value}</div>
        <div class="note">${t.note}</div>
      </div>`
    )
    .join("");

  const allDates = live.flatMap((a) => a.rows.map((r) => r.date));
  const updated = allDates.length ? allDates.sort()[allDates.length - 1] : null;
  document.getElementById("updated").textContent = updated
    ? `Updated ${updated}`
    : "";
}

function buildAppCards() {
  const el = document.getElementById("apps");
  el.innerHTML = apps
    .map((a, i) => {
      const color = cssVar(a.seriesVar);
      const head = `
        <div class="name-row">
          <span class="dot" style="background:${color}"></span>
          <span>${a.name}</span>
          <span class="links">
            <a href="https://github.com/${a.repo}" title="GitHub repo">GitHub</a>
            <a href="https://apps.microsoft.com/detail/${a.storeId}" title="Microsoft Store listing">Store</a>
          </span>
        </div>`;
      if (!a.rows) {
        return `<div class="card app empty">${head}<div class="value">No data yet</div></div>`;
      }
      const gh = lastKnown(a.rows, "github");
      const st = lastKnown(a.rows, "store");
      const combined = (gh ?? 0) + (st ?? 0);
      return `
        <div class="card app">
          ${head}
          <div class="value">${fmt(combined)}</div>
          <p class="breakdown">GitHub ${fmt(gh)} &middot; Store ${fmt(st)}</p>
          <div class="spark"><canvas id="spark-${i}"></canvas></div>
        </div>`;
    })
    .join("");
}

// Direct labels at each line's end, nudged apart when they collide.
const endLabels = {
  id: "endLabels",
  afterDatasetsDraw(chart) {
    const ink = cssVar("--ink-2");
    const labels = [];
    chart.data.datasets.forEach((ds, i) => {
      if (ds.skipEndLabel) return;
      const meta = chart.getDatasetMeta(i);
      for (let p = meta.data.length - 1; p >= 0; p--) {
        const el = meta.data[p];
        if (el && !isNaN(el.y) && ds.data[p] != null) {
          labels.push({ text: ds.label, x: el.x, y: el.y });
          break;
        }
      }
    });
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    }
    const { ctx } = chart;
    ctx.save();
    ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = ink;
    ctx.textBaseline = "middle";
    labels.forEach((l) => ctx.fillText(l.text, l.x + 7, l.y));
    ctx.restore();
  },
};

function buildMainChart() {
  const live = apps.filter((a) => a.rows);
  if (live.length === 0) return;

  const dates = [...new Set(live.flatMap((a) => a.rows.map((r) => r.date)))].sort();
  const perApp = live.map((a) => {
    const byDate = new Map(
      a.rows.map((r, i) => [r.date, combinedSeries(a.rows)[i]])
    );
    // Forward-fill over the union axis so lines don't gap on days
    // another app recorded but this one didn't.
    let last = null;
    return dates.map((d) => (byDate.has(d) ? (last = byDate.get(d)) : last));
  });
  const grand = dates.map((_, i) =>
    perApp.reduce((s, series) => s + (series[i] ?? 0), 0)
  );

  const ink2 = cssVar("--ink-2");
  const muted = cssVar("--muted");
  const grid = cssVar("--grid");
  const surface = cssVar("--surface");
  const border = cssVar("--baseline");

  const datasets = live.map((a, i) => ({
    label: a.name,
    data: perApp[i],
    borderColor: cssVar(a.seriesVar),
    backgroundColor: cssVar(a.seriesVar),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2,
    spanGaps: true,
  }));
  datasets.push({
    label: "Total",
    data: grand,
    borderColor: cssVar("--total-line"),
    backgroundColor: cssVar("--total-line"),
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.2,
    spanGaps: true,
  });

  charts.push(
    new Chart(document.getElementById("chart"), {
      type: "line",
      data: { labels: dates, datasets },
      plugins: [endLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 100 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: {
              color: ink2,
              usePointStyle: true,
              pointStyle: "circle",
              boxWidth: 7,
              boxHeight: 7,
              padding: 14,
            },
          },
          tooltip: {
            backgroundColor: surface,
            titleColor: cssVar("--ink"),
            bodyColor: ink2,
            borderColor: border,
            borderWidth: 1,
            padding: 10,
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: border },
            ticks: { color: muted, maxTicksLimit: 7, maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            grid: { color: grid },
            border: { display: false },
            ticks: { color: muted, precision: 0 },
          },
        },
      },
    })
  );
}

function buildSparklines() {
  apps.forEach((a, i) => {
    if (!a.rows) return;
    const canvas = document.getElementById(`spark-${i}`);
    if (!canvas) return;
    charts.push(
      new Chart(canvas, {
        type: "line",
        data: {
          labels: a.rows.map((r) => r.date),
          datasets: [
            {
              data: combinedSeries(a.rows),
              borderColor: cssVar(a.seriesVar),
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.3,
              spanGaps: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          events: [],
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: { x: { display: false }, y: { display: false } },
        },
      })
    );
  });
}

function render() {
  charts.forEach((c) => c.destroy());
  charts = [];
  buildTiles();
  buildAppCards();
  buildSparklines();
  buildMainChart();
}

async function main() {
  const status = document.getElementById("status");
  try {
    await loadData();
  } catch (err) {
    status.textContent = `Couldn't load stats (${err.message}). Try again shortly.`;
    return;
  }
  if (!apps.some((a) => a.rows)) {
    status.textContent =
      "No data recorded yet — check back after the next daily run.";
    return;
  }
  status.hidden = true;
  document.getElementById("content").hidden = false;
  render();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
}

main();
