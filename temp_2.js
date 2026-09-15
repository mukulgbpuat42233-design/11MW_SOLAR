
function getHeatmapColor(mw) {
  if (!mw || mw <= 0.0001) {
    return {
      bg: "bg-slate-100 text-slate-400 border border-slate-200/70 hover:bg-slate-200",
      tier: "Zero"
    };
  }
  if (mw <= 2.0) {
    return {
      bg: "bg-amber-100 text-amber-900 border border-amber-200 hover:bg-amber-200",
      tier: "Low"
    };
  } else if (mw <= 5.0) {
    return {
      bg: "bg-amber-200 text-amber-950 border border-amber-300 hover:bg-amber-300",
      tier: "Moderate"
    };
  } else if (mw <= 7.5) {
    return {
      bg: "bg-amber-300 text-amber-950 border border-amber-400 hover:bg-amber-400 font-medium",
      tier: "High"
    };
  } else if (mw <= 9.5) {
    return {
      bg: "bg-amber-400 text-amber-950 border border-amber-500 hover:bg-amber-500 font-bold",
      tier: "Very High"
    };
  } else {
    return {
      bg: "bg-amber-500 text-white border border-amber-600 hover:bg-amber-600 font-extrabold shadow-sm",
      tier: "Peak"
    };
  }
}

function selectHeatmapBlock(b, mw, mwh, mcp, amt, periodStr) {
  const el = $("heatmapSelectedBlockInfo");
  if (!el) return;
  if (mw > 0) {
    el.innerHTML = `<strong>Block ${b} (${periodStr}):</strong> <span class="text-amber-700 font-bold">${mw.toFixed(3)} MW</span> (${mwh.toFixed(3)} MWh) • MCP: <strong>₹${mcp.toFixed(2)}</strong> • Value: <strong class="text-emerald-700">₹${amt.toLocaleString("en-IN", {maximumFractionDigits: 2})}</strong>`;
  } else {
    el.innerHTML = `<strong>Block ${b} (${periodStr}):</strong> 0.000 MW • Night / Inactive Block`;
  }
}

function hoverHeatmapBlock(b, mw, mwh, mcp, periodStr) {
  const el = $("heatmapSelectedBlockInfo");
  if (!el) return;
  if (mw > 0) {
    el.innerHTML = `Block ${b} (${periodStr}): <span class="font-bold text-amber-700">${mw.toFixed(3)} MW</span> (${mwh.toFixed(3)} MWh) • MCP: ₹${mcp.toFixed(2)}/MWh`;
  } else {
    el.innerHTML = `Block ${b} (${periodStr}): 0.000 MW (Zero output)`;
  }
}

function render96BlockStudy(date){
  const heat=$("heatmap96");
  if(!heat) return;
  const rows=$("blockStudyRows");
  let d = date || $("heatmapDate")?.value || $("clearDateInput")?.value || "";
  if (!d) {
    const all = sortedTrades();
    if (all.length > 0) d = all[all.length - 1].date;
  }
  if ($("heatmapDate") && d) $("heatmapDate").value = d;
  if ($("clearDateInput") && d && !$("clearDateInput").value) $("clearDateInput").value = d;

  const by={};
  const seg = window.dashSeg || "ALL";
  const txn = window.dashTxn || "ALL";
  let dayTrades = sortedTrades().filter(t=>t.date===d);
  if (seg !== "ALL") dayTrades = dayTrades.filter(t=>(t.seg||"G-DAM")===seg);
  if (txn !== "ALL") dayTrades = dayTrades.filter(t=>(t.txn||"SELL")===txn);
  dayTrades.forEach(t=>by[t.block]=t);

  const maxMw = dayTrades.reduce((mx, t) => Math.max(mx, Math.abs(t.qty || 0)), 0);
  const totalValue = dayTrades.reduce((sum, t) => sum + amount(t), 0);

  const p=b=>{let s=(b-1)*15,e=b*15,f=x=>String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0");return f(s)+"-"+(b===96?"24:00":f(e));};
  
  heat.innerHTML=Array.from({length:96},(_,i)=>{
    const b=i+1, t=by[b];
    const mw = t ? Math.abs(t.qty) : 0;
    const m = mw * 0.25;
    const mcp = t ? (+t.mcp || 0) : 0;
    const amt = t ? amount(t) : 0;
    const sTag = t ? (t.seg || "G-DAM") : "";
    const txTag = t ? (t.txn || "SELL") : "";
    const { bg } = getHeatmapColor(mw);
    return `<div class="${bg} rounded-md p-1 min-h-[44px] flex flex-col items-center justify-between cursor-pointer transition-transform hover:scale-105 hover:z-10 hover:shadow select-none text-center"
      onclick="selectHeatmapBlock(${b}, ${mw}, ${m}, ${mcp}, ${amt}, '${p(b)}')"
      onmouseenter="hoverHeatmapBlock(${b}, ${mw}, ${m}, ${mcp}, '${p(b)}')"
      title="Block ${b} (${p(b)}): ${mw>0 ? mw.toFixed(3)+' MW ('+m.toFixed(3)+' MWh)' : '0 MW'} | MCP: ₹${mcp.toFixed(2)}${t ? ' | ' + sTag + ' ' + txTag : ''}">
      <span class="text-[8px] sm:text-[9px] font-mono leading-none opacity-80">B${b}</span>
      <span class="text-[9px] sm:text-[10px] leading-tight font-bold">${mw > 0 ? (mw >= 10 ? mw.toFixed(1) : mw.toFixed(2)) : '—'}</span>
      <span class="text-[7px] sm:text-[8px] leading-none opacity-70">${mw > 0 ? m.toFixed(2)+'u' : ''}</span>
    </div>`;
  }).join("");

  if(rows) {
    rows.innerHTML=Array.from({length:96},(_,i)=>{
      const b=i+1, t=by[b];
      const mw = t ? Math.abs(t.qty) : 0;
      const m = mw * 0.25;
      const mcp = t ? (+t.mcp || 0) : 0;
      const amt = t ? amount(t) : 0;
      const sTag = t ? (t.seg || "G-DAM") : "—";
      const txTag = t ? (t.txn || "SELL") : "—";
      return `<tr class="border-b border-slate-100 hover:bg-slate-50 transition">
        <td class="p-2 text-left font-bold text-slate-800">Block ${b}</td>
        <td class="p-2 font-mono text-slate-500">${p(b)}</td>
        <td class="p-2 font-semibold ${mw>0?'text-slate-800':'text-slate-400'}">${mw > 0 ? mw.toFixed(3) : "—"}</td>
        <td class="p-2 font-bold ${m>0?'text-blue-700':'text-slate-400'}">${m > 0 ? m.toFixed(4) : "—"}</td>
        <td class="p-2">${t ? "₹" + mcp.toFixed(2) : "—"}</td>
        <td class="p-2 font-bold ${amt>0?'text-emerald-700':'text-slate-400'}">${amt > 0 ? "₹" + amt.toFixed(2) : "₹0.00"}</td>
        <td class="p-2 text-center font-bold ${t ? (mw > 0 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400'}">
          ${t ? (mw > 0 ? `${sTag} ${txTag}` : 'ZERO') : 'NO DATA'}
        </td>
      </tr>`;
    }).join("");
  }

  const v=validateDaily11MW(d);
  if($("heatmapStatus")) {
    if (!d) {
      $("heatmapStatus").textContent = "No date selected. Upload IEX DOR Excel/PDF to view 96-block generation.";
    } else {
      let filterNote = "";
      if (seg !== "ALL" || txn !== "ALL") filterNote = ` [Filter: ${seg}/${txn}]`;
      $("heatmapStatus").textContent = `${d}${filterNote} • ${dayTrades.length}/96 blocks scheduled • Total Energy: ${dayTrades.reduce((s,x)=>s+qtyMwh(x),0).toFixed(3)} MWh (${money(totalValue)}) • Peak: ${maxMw.toFixed(3)} MW • ${v.physicalOK ? "11 MW Limit OK" : "PHYSICAL LIMIT ERROR"}`;
    }
  }
}
const _rd=window.renderDashboard;
window.renderDashboard=function(){try{_rd&&_rd();}finally{render96BlockStudy();}};

/* =========================================================================
   WEATHER & SOLAR GENERATION CORRELATION ENGINE (THDCIL 11 MW SOLAR)
   ========================================================================= */

// Site Configuration
const weatherSiteConfig = {
  plantName: localStorage.getItem("thdc_weather_plantName") || "THDCIL 11 MW Floating Solar PV Plant",
  locationText: localStorage.getItem("thdc_weather_location") || "Raw Water Reservoir, Khurja STPP, Bulandshahr, Uttar Pradesh",
  lat: parseFloat(localStorage.getItem("thdc_weather_lat")) || 28.239,
  lon: parseFloat(localStorage.getItem("thdc_weather_lon")) || 77.873,
  capacityMw: parseFloat(localStorage.getItem("thdc_weather_capacity")) || 11.0,
  benchmarkPr: parseFloat(localStorage.getItem("thdc_weather_pr")) || 80.0
};

let weatherRawRecords = [];
let weatherMergedData = [];
let weatherFilterCause = "ALL";
let weatherTimelineChartInst = null;
let weatherScatterChartInst = null;
let modalDayChartInst = null;

function updateWeatherSiteDisplay() {
  if ($("weatherPlantNameDisplay")) $("weatherPlantNameDisplay").textContent = weatherSiteConfig.plantName;
  if ($("weatherLocationDisplay")) $("weatherLocationDisplay").innerHTML = `<i class="fa-solid fa-location-dot text-rose-400 mr-1"></i>${weatherSiteConfig.locationText}`;
  if ($("weatherCoordsDisplay")) $("weatherCoordsDisplay").textContent = `${weatherSiteConfig.lat.toFixed(3)}° N, ${weatherSiteConfig.lon.toFixed(3)}° E (Elev: ~199 m)`;
  if ($("weatherCapacityDisplay")) $("weatherCapacityDisplay").textContent = `${weatherSiteConfig.capacityMw.toFixed(2)} MW AC`;
  if ($("weatherPrBenchmarkDisplay")) $("weatherPrBenchmarkDisplay").textContent = `Benchmark PR: ${weatherSiteConfig.benchmarkPr.toFixed(1)}%`;
}

function openWeatherLocationModal() {
  const m = $("weatherLocationModal");
  if (!m) return;
  if ($("cfgPlantName")) $("cfgPlantName").value = weatherSiteConfig.plantName;
  if ($("cfgLocationText")) $("cfgLocationText").value = weatherSiteConfig.locationText;
  if ($("cfgLat")) $("cfgLat").value = weatherSiteConfig.lat;
  if ($("cfgLon")) $("cfgLon").value = weatherSiteConfig.lon;
  if ($("cfgCapacity")) $("cfgCapacity").value = weatherSiteConfig.capacityMw;
  if ($("cfgBenchmarkPr")) $("cfgBenchmarkPr").value = weatherSiteConfig.benchmarkPr;
  m.classList.remove("hidden");
}
window.openWeatherLocationModal = openWeatherLocationModal;

function closeWeatherLocationModal() {
  const m = $("weatherLocationModal");
  if (m) m.classList.add("hidden");
}
window.closeWeatherLocationModal = closeWeatherLocationModal;

function applyLocationPreset(val) {
  if (val === "khurja") {
    if ($("cfgPlantName")) $("cfgPlantName").value = "11 MW Khurja Floating Solar Power Plant";
    if ($("cfgLocationText")) $("cfgLocationText").value = "Raw Water Reservoir, Khurja STPP, Bulandshahr, Uttar Pradesh";
    if ($("cfgLat")) $("cfgLat").value = 28.239;
    if ($("cfgLon")) $("cfgLon").value = 77.873;
    if ($("cfgCapacity")) $("cfgCapacity").value = 11.0;
    if ($("cfgBenchmarkPr")) $("cfgBenchmarkPr").value = 80.0;
  } else if (val === "tehri") {
    if ($("cfgPlantName")) $("cfgPlantName").value = "THDCIL Tehri Hydro & Solar Complex";
    if ($("cfgLocationText")) $("cfgLocationText").value = "Tehri Garhwal, Uttarakhand";
    if ($("cfgLat")) $("cfgLat").value = 30.378;
    if ($("cfgLon")) $("cfgLon").value = 78.480;
    if ($("cfgCapacity")) $("cfgCapacity").value = 11.0;
    if ($("cfgBenchmarkPr")) $("cfgBenchmarkPr").value = 79.0;
  } else if (val === "dhukwan") {
    if ($("cfgPlantName")) $("cfgPlantName").value = "THDCIL Dhukwan Solar Project";
    if ($("cfgLocationText")) $("cfgLocationText").value = "Babina, Jhansi district, Uttar Pradesh";
    if ($("cfgLat")) $("cfgLat").value = 25.204;
    if ($("cfgLon")) $("cfgLon").value = 78.567;
    if ($("cfgCapacity")) $("cfgCapacity").value = 24.0;
    if ($("cfgBenchmarkPr")) $("cfgBenchmarkPr").value = 80.0;
  }
}
window.applyLocationPreset = applyLocationPreset;

function saveWeatherLocationSettings() {
  weatherSiteConfig.plantName = $("cfgPlantName")?.value || "11 MW Khurja Floating Solar Power Plant";
  weatherSiteConfig.locationText = $("cfgLocationText")?.value || "Raw Water Reservoir, Khurja STPP, Bulandshahr, Uttar Pradesh";
  weatherSiteConfig.lat = parseFloat($("cfgLat")?.value) || 28.239;
  weatherSiteConfig.lon = parseFloat($("cfgLon")?.value) || 77.873;
  weatherSiteConfig.capacityMw = parseFloat($("cfgCapacity")?.value) || 11.0;
  weatherSiteConfig.benchmarkPr = parseFloat($("cfgBenchmarkPr")?.value) || 80.0;

  localStorage.setItem("thdc_weather_plantName", weatherSiteConfig.plantName);
  localStorage.setItem("thdc_weather_location", weatherSiteConfig.locationText);
  localStorage.setItem("thdc_weather_lat", weatherSiteConfig.lat);
  localStorage.setItem("thdc_weather_lon", weatherSiteConfig.lon);
  localStorage.setItem("thdc_weather_capacity", weatherSiteConfig.capacityMw);
  localStorage.setItem("thdc_weather_pr", weatherSiteConfig.benchmarkPr);

  updateWeatherSiteDisplay();
  closeWeatherLocationModal();
  fetchWeatherCorrelationData();
}
window.saveWeatherLocationSettings = saveWeatherLocationSettings;

function setWeatherPreset(type) {
  const trades = sortedTrades();
  if (type === "trades") {
    if (trades.length) {
      if ($("weatherStartDate")) $("weatherStartDate").value = trades[0].date;
      if ($("weatherEndDate")) $("weatherEndDate").value = trades[trades.length - 1].date;
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const prev = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      if ($("weatherStartDate")) $("weatherStartDate").value = prev;
      if ($("weatherEndDate")) $("weatherEndDate").value = today;
    }
  } else if (type === "14d") {
    const today = new Date().toISOString().slice(0, 10);
    const prev = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    if ($("weatherStartDate")) $("weatherStartDate").value = prev;
    if ($("weatherEndDate")) $("weatherEndDate").value = today;
  } else if (type === "30d") {
    const today = new Date().toISOString().slice(0, 10);
    const prev = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    if ($("weatherStartDate")) $("weatherStartDate").value = prev;
    if ($("weatherEndDate")) $("weatherEndDate").value = today;
  } else if (type === "may2024") {
    if ($("weatherStartDate")) $("weatherStartDate").value = "2024-05-01";
    if ($("weatherEndDate")) $("weatherEndDate").value = "2024-05-31";
  } else if (type === "jul2024") {
    if ($("weatherStartDate")) $("weatherStartDate").value = "2024-07-01";
    if ($("weatherEndDate")) $("weatherEndDate").value = "2024-07-31";
  }
  fetchWeatherCorrelationData();
}
window.setWeatherPreset = setWeatherPreset;

function calcPearson(xs, ys) {
  if (!xs || !ys || xs.length !== ys.length || xs.length < 2) return 0;
  const n = xs.length;
  const avgX = xs.reduce((a, b) => a + b, 0) / n;
  const avgY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - avgX;
    const dy = ys[i] - avgY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : +(num / den).toFixed(3);
}

// Diagnose Generation Drop Root Cause
function diagnoseDrop(actualMwh, insolation, cloudCover, rain, tempMax, weatherCode) {
  const cap = weatherSiteConfig.capacityMw;
  const targetPr = weatherSiteConfig.benchmarkPr / 100;
  const expectedMwh = cap * insolation * targetPr;
  const varianceMwh = actualMwh - expectedMwh;
  const pctDrop = expectedMwh > 0 ? ((actualMwh - expectedMwh) / expectedMwh) * 100 : 0;
  const pr = (cap * insolation > 0) ? (actualMwh / (cap * insolation)) * 100 : 0;
  const specificYield = (actualMwh * 1000) / (cap * 1000); // kWh/kWp

  // Drop threshold: actual generation > 18% below theoretical or under 26 MWh on sunny day
  const isDrop = (expectedMwh > 15 && pctDrop < -18.0) || (insolation > 4.5 && actualMwh < 26.0);

  let causeKey = "NORMAL";
  let causeLabel = "Optimal Clear-Sky Yield";
  let causeIcon = "fa-sun text-emerald-500";
  let badgeCls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  let explanation = "Generation is tracking normally with theoretical solar insolation model and healthy performance ratio.";

  if (isDrop) {
    if (rain >= 8 || (weatherCode >= 61 && weatherCode <= 99)) {
      causeKey = "RAIN";
      causeLabel = "Monsoon Rain Obscuration";
      causeIcon = "fa-cloud-showers-heavy text-blue-600";
      badgeCls = "bg-blue-50 text-blue-800 border-blue-200";
      explanation = `Heavy rainfall (${rain} mm) and dense storm cloud cover severely attenuated Global Horizontal Irradiance (GHI). Generation dropped by ${Math.abs(pctDrop).toFixed(1)}% due to meteorological obstruction.`;
    } else if (insolation >= 4.5 && cloudCover <= 42 && actualMwh < expectedMwh * 0.68) {
      causeKey = "CURTAILMENT";
      causeLabel = "Grid Curtailment / Backdown";
      causeIcon = "fa-bolt text-purple-600";
      badgeCls = "bg-purple-50 text-purple-800 border-purple-200";
      explanation = `Solar insolation was high (${insolation.toFixed(2)} kWh/m²) with low cloud cover (${cloudCover}%), yet dispatched output was curtailed (${actualMwh.toFixed(1)} MWh vs ${expectedMwh.toFixed(1)} MWh expected). Indicates grid backdown, transmission corridor restriction, or commercial bid non-clearance rather than weather.`;
    } else if (cloudCover >= 50 || insolation < 3.8) {
      causeKey = "CLOUD";
      causeLabel = "Cloud Cover Attenuation";
      causeIcon = "fa-cloud text-slate-500";
      badgeCls = "bg-slate-100 text-slate-800 border-slate-300";
      explanation = `High cloud cover (${cloudCover}%) reduced global solar irradiance to ${insolation.toFixed(2)} kWh/m² (${(insolation*3.6).toFixed(1)} MJ/m²). Generation loss is in direct proportion to diffuse solar resource limitation.`;
    } else if (tempMax >= 39.0 && insolation >= 4.8) {
      causeKey = "HEAT";
      causeLabel = "Thermal Heat Derating";
      causeIcon = "fa-temperature-high text-amber-600";
      badgeCls = "bg-amber-50 text-amber-800 border-amber-200";
      explanation = `Extreme ambient temperatures (${tempMax}°C) caused PV cell junction temperatures to exceed 60°C. Standard silicon negative temperature coefficient (-0.38%/°C) reduced efficiency and output despite high solar radiation.`;
    } else {
      causeKey = "CLOUD";
      causeLabel = "Partial Cloud Obscuration";
      causeIcon = "fa-cloud-sun text-slate-600";
      badgeCls = "bg-slate-100 text-slate-700 border-slate-200";
      explanation = `Passing clouds (${cloudCover}% cloud cover) created intermittent solar dips during peak generation trading blocks.`;
    }
  } else if (tempMax >= 41.0) {
    causeKey = "HEAT";
    causeLabel = "Mild Thermal Derating";
    causeIcon = "fa-temperature-high text-amber-500";
    badgeCls = "bg-amber-50 text-amber-700 border-amber-200";
    explanation = `High ambient temperature (${tempMax}°C) incurred thermal derating, though total energy remained above critical drop threshold.`;
  }

  return {
    isDrop,
    causeKey,
    causeLabel,
    causeIcon,
    badgeCls,
    explanation,
    expectedMwh: +expectedMwh.toFixed(3),
    varianceMwh: +varianceMwh.toFixed(3),
    pctDrop: +pctDrop.toFixed(1),
    pr: +pr.toFixed(1),
    specificYield: +specificYield.toFixed(2)
  };
}

// Fetch weather from server and correlate with state.trades
async function fetchWeatherCorrelationData() {
  const btn = $("weatherFetchBtn");
  const origHtml = btn ? btn.innerHTML : "";
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Fetching Weather...</span>`;

  try {
    let sDate = $("weatherStartDate")?.value;
    let eDate = $("weatherEndDate")?.value;

    const allTrades = sortedTrades();
    if (!sDate || !eDate) {
      if (allTrades.length) {
        sDate = allTrades[0].date;
        eDate = allTrades[allTrades.length - 1].date;
        if ($("weatherStartDate")) $("weatherStartDate").value = sDate;
        if ($("weatherEndDate")) $("weatherEndDate").value = eDate;
      } else {
        sDate = "2024-05-01";
        eDate = "2024-05-14";
        if ($("weatherStartDate")) $("weatherStartDate").value = sDate;
        if ($("weatherEndDate")) $("weatherEndDate").value = eDate;
      }
    }

    const lat = weatherSiteConfig.lat;
    const lon = weatherSiteConfig.lon;
    const url = `/api/weather?startDate=${sDate}&endDate=${eDate}&lat=${lat}&lon=${lon}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Weather fetch failed: ${resp.statusText}`);
    const json = await resp.json();

    if (!json.success || !Array.isArray(json.daily)) {
      throw new Error(json.error || "No weather records received");
    }

    weatherRawRecords = json.daily;
    if ($("weatherSourceBadge")) {
      const src = json.dataSource === "open-meteo" ? "Open-Meteo GHI Archive" : "Khurja Climate Model";
      $("weatherSourceBadge").innerHTML = `<i class="fa-solid fa-satellite text-[10px]"></i> ${src}`;
    }

    // Merge each weather day with trade generation data
    const tradeMap = {};
    allTrades.forEach(t => {
      const d = t.date;
      if (!tradeMap[d]) tradeMap[d] = { mwh: 0, blocks: [], maxMw: 0, revenue: 0 };
      const mw = Math.abs(t.qty || 0);
      tradeMap[d].mwh += mw * 0.25;
      tradeMap[d].revenue += amount(t);
      if (mw > tradeMap[d].maxMw) tradeMap[d].maxMw = mw;
      tradeMap[d].blocks.push(t);
    });

    weatherMergedData = weatherRawRecords.map(w => {
      const d = w.date;
      const tInfo = tradeMap[d] || { mwh: 0, blocks: [], maxMw: 0, revenue: 0 };
      const diag = diagnoseDrop(tInfo.mwh, w.solarInsolationKwh, w.cloudCover, w.precipMm, w.tempMax, w.weatherCode);

      return {
        ...w,
        actualMwh: +tInfo.mwh.toFixed(3),
        actualMu: +(tInfo.mwh / 1000).toFixed(4),
        actualRevenue: +tInfo.revenue.toFixed(2),
        maxMw: +tInfo.maxMw.toFixed(3),
        blocksCount: tInfo.blocks.length,
        hasTrades: tInfo.blocks.length > 0,
        ...diag
      };
    });

    renderWeatherCorrelationUI();
  } catch (err) {
    console.error("Weather correlation error:", err);
    alert(`Weather Correlation Error: ${err.message}`);
  } finally {
    if (btn) btn.innerHTML = origHtml;
  }
}
window.fetchWeatherCorrelationData = fetchWeatherCorrelationData;

function setWeatherCauseFilter(cause) {
  weatherFilterCause = cause;
  document.querySelectorAll(".weather-cause-btn").forEach(b => {
    if (b.dataset.cause === cause) {
      b.classList.add("active", "bg-slate-900", "text-white");
      b.classList.remove("bg-white", "bg-rose-50", "bg-blue-50", "bg-slate-100", "bg-amber-50", "bg-purple-50", "bg-emerald-50");
    } else {
      b.classList.remove("active", "bg-slate-900", "text-white");
    }
  });
  renderWeatherTable();
}
window.setWeatherCauseFilter = setWeatherCauseFilter;

function renderWeatherCorrelationUI() {
  updateWeatherSiteDisplay();

  // 1. Calculate Analytics and KPIs
  const daysWithTrades = weatherMergedData.filter(d => d.hasTrades && d.actualMwh > 0);
  const dataToEval = daysWithTrades.length > 0 ? daysWithTrades : weatherMergedData;

  const insolationArr = dataToEval.map(d => d.solarInsolationKwh);
  const actualGenArr = dataToEval.map(d => d.actualMwh);
  const cloudArr = dataToEval.map(d => d.cloudCover);

  const rPearson = calcPearson(insolationArr, actualGenArr);
  const rCloud = calcPearson(cloudArr, actualGenArr);

  const dropDays = weatherMergedData.filter(d => d.isDrop);
  const totalDays = weatherMergedData.length;

  const totalActualMwh = weatherMergedData.reduce((s, d) => s + d.actualMwh, 0);
  const totalExpectedMwh = weatherMergedData.reduce((s, d) => s + d.expectedMwh, 0);
  const avgPr = totalExpectedMwh > 0 ? (totalActualMwh / (weatherSiteConfig.capacityMw * weatherMergedData.reduce((s, d) => s + d.solarInsolationKwh, 0))) * 100 : 0;

  // Counts by Cause
  const counts = { ALL: totalDays, DROPS: dropDays.length, RAIN: 0, CLOUD: 0, HEAT: 0, CURTAILMENT: 0, NORMAL: 0 };
  weatherMergedData.forEach(d => {
    if (counts[d.causeKey] !== undefined) counts[d.causeKey]++;
  });

  if ($("cntCauseAll")) $("cntCauseAll").textContent = counts.ALL;
  if ($("cntCauseDrops")) $("cntCauseDrops").textContent = counts.DROPS;
  if ($("cntCauseRain")) $("cntCauseRain").textContent = counts.RAIN;
  if ($("cntCauseCloud")) $("cntCauseCloud").textContent = counts.CLOUD;
  if ($("cntCauseHeat")) $("cntCauseHeat").textContent = counts.HEAT;
  if ($("cntCauseCurtailment")) $("cntCauseCurtailment").textContent = counts.CURTAILMENT;
  if ($("cntCauseNormal")) $("cntCauseNormal").textContent = counts.NORMAL;
  if ($("weatherCauseSummaryCount")) $("weatherCauseSummaryCount").textContent = `${totalDays} days analyzed (${dropDays.length} drops identified)`;

  // Update KPI displays
  if ($("weatherKpiPearson")) {
    $("weatherKpiPearson").textContent = rPearson > 0 ? `+${rPearson.toFixed(2)}` : `${rPearson.toFixed(2)}`;
    let interp = "Weak Coupling";
    let interpCls = "text-slate-500";
    if (rPearson >= 0.85) { interp = "Very Strong Positive Coupling"; interpCls = "text-emerald-700"; }
    else if (rPearson >= 0.65) { interp = "Moderate Solar Coupling"; interpCls = "text-blue-700"; }
    else if (rPearson > 0) { interp = "Disrupted Solar Coupling"; interpCls = "text-amber-700"; }
    if ($("weatherKpiPearsonSub")) $("weatherKpiPearsonSub").innerHTML = `<span class="${interpCls} font-bold">${interp}</span> (Cloud r: ${rCloud.toFixed(2)})`;
  }

  if ($("weatherKpiDrops")) {
    const dropPct = totalDays > 0 ? ((dropDays.length / totalDays) * 100).toFixed(1) : 0;
    $("weatherKpiDrops").textContent = `${dropDays.length} / ${totalDays} Days`;
    if ($("weatherKpiDropsSub")) $("weatherKpiDropsSub").textContent = `${dropPct}% incident rate (Output < 82% expected)`;
  }

  if ($("weatherKpiPr")) {
    $("weatherKpiPr").textContent = `${avgPr.toFixed(1)}%`;
    if ($("weatherKpiPrSub")) $("weatherKpiPrSub").textContent = `Gen: ${totalActualMwh.toFixed(1)} MWh (Exp: ${totalExpectedMwh.toFixed(1)} MWh)`;
  }

  if ($("weatherKpiCause")) {
    let topCause = "None";
    let topCount = 0;
    if (counts.CLOUD > topCount) { topCause = "Cloud Attenuation"; topCount = counts.CLOUD; }
    if (counts.RAIN > topCount) { topCause = "Monsoon Rain"; topCount = counts.RAIN; }
    if (counts.CURTAILMENT > topCount) { topCause = "Grid Curtailment"; topCount = counts.CURTAILMENT; }
    if (counts.HEAT > topCount) { topCause = "Heat Derating"; topCount = counts.HEAT; }

    if (topCount === 0) topCause = "Clear-Sky Normal";
    $("weatherKpiCause").textContent = topCause;
    if ($("weatherKpiCauseSub")) $("weatherKpiCauseSub").textContent = topCount > 0 ? `${topCount} drop events (${((topCount/Math.max(1, dropDays.length))*100).toFixed(0)}% of drops)` : "No drops detected";
  }

  // Render Charts and Table
  renderWeatherCharts();
  renderWeatherTable();
}

function renderWeatherCharts() {
  const labels = weatherMergedData.map(d => d.date.slice(5)); // MM-DD
  const actualMwh = weatherMergedData.map(d => d.actualMwh);
  const expectedMwh = weatherMergedData.map(d => d.expectedMwh);
  const insolation = weatherMergedData.map(d => d.solarInsolationKwh);
  const cloud = weatherMergedData.map(d => d.cloudCover);

  // 1. Dual-Axis Timeline Chart
  const ctx1 = $("weatherTimelineChart");
  if (ctx1) {
    if (weatherTimelineChartInst) weatherTimelineChartInst.destroy();
    weatherTimelineChartInst = new Chart(ctx1, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Actual Generation (MWh)",
            data: actualMwh,
            backgroundColor: weatherMergedData.map(d => d.isDrop ? "rgba(225, 29, 72, 0.85)" : "rgba(37, 99, 235, 0.85)"),
            borderColor: weatherMergedData.map(d => d.isDrop ? "#be123c" : "#1d4ed8"),
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: "yGen",
            order: 2
          },
          {
            type: "line",
            label: "Expected Generation (MWh @ 80% PR)",
            data: expectedMwh,
            borderColor: "#9333ea",
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
            yAxisID: "yGen",
            order: 1
          },
          {
            type: "line",
            label: "Solar Insolation (kWh/m²)",
            data: insolation,
            borderColor: "#d97706",
            backgroundColor: "#d97706",
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
            yAxisID: "yWeather",
            order: 0
          },
          {
            type: "line",
            label: "Cloud Cover (%)",
            data: cloud,
            borderColor: "#94a3b8",
            borderWidth: 1.5,
            borderDash: [2, 2],
            pointRadius: 2,
            fill: false,
            yAxisID: "yWeather",
            order: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          yGen: {
            type: "linear",
            position: "left",
            title: { display: true, text: "Generation (MWh)", font: { size: 11, weight: "bold" } },
            ticks: { font: { size: 10 } },
            grid: { color: "#f1f5f9" },
            beginAtZero: true
          },
          yWeather: {
            type: "linear",
            position: "right",
            title: { display: true, text: "Insolation (kWh/m²) / Cloud (%)", font: { size: 11, weight: "bold" } },
            ticks: { font: { size: 10 } },
            grid: { display: false },
            beginAtZero: true
          }
        },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              afterBody: function(items) {
                const idx = items[0].dataIndex;
                const d = weatherMergedData[idx];
                return [
                  `Weather: ${d.weatherDesc} (${d.tempMax}°C max)`,
                  `Rainfall: ${d.precipMm} mm`,
                  `Performance Ratio: ${d.pr.toFixed(1)}%`,
                  `Diagnosis: ${d.causeLabel}`
                ];
              }
            }
          }
        }
      }
    });
  }

  // 2. Scatter & Regression Chart
  const ctx2 = $("weatherScatterChart");
  if (ctx2) {
    if (weatherScatterChartInst) weatherScatterChartInst.destroy();

    const normalPoints = [];
    const dropPoints = [];
    weatherMergedData.forEach(d => {
      const pt = { x: d.solarInsolationKwh, y: d.actualMwh, date: d.date, diag: d.causeLabel, pr: d.pr };
      if (d.isDrop) dropPoints.push(pt);
      else normalPoints.push(pt);
    });

    // Ideal theoretical line (0 to 8 kWh/m2)
    const cap = weatherSiteConfig.capacityMw;
    const prTarget = weatherSiteConfig.benchmarkPr / 100;
    const idealLine = [
      { x: 0, y: 0 },
      { x: 3, y: +(cap * 3 * prTarget).toFixed(1) },
      { x: 5, y: +(cap * 5 * prTarget).toFixed(1) },
      { x: 7.5, y: +(cap * 7.5 * prTarget).toFixed(1) }
    ];

    weatherScatterChartInst = new Chart(ctx2, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Normal Operating Days",
            data: normalPoints,
            backgroundColor: "rgba(16, 185, 129, 0.8)",
            borderColor: "#059669",
            borderWidth: 1.5,
            pointRadius: 5,
            pointHoverRadius: 7
          },
          {
            label: "Identified Generation Drops",
            data: dropPoints,
            backgroundColor: "rgba(225, 29, 72, 0.85)",
            borderColor: "#be123c",
            borderWidth: 1.5,
            pointRadius: 6,
            pointHoverRadius: 8
          },
          {
            type: "line",
            label: "Benchmark 80% PR Line",
            data: idealLine,
            borderColor: "#2563eb",
            borderWidth: 2,
            borderDash: [3, 3],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: "Solar Insolation (kWh/m² / Peak Sun Hours)", font: { size: 11, weight: "bold" } },
            ticks: { font: { size: 10 } },
            grid: { color: "#f1f5f9" },
            beginAtZero: true
          },
          y: {
            title: { display: true, text: "Delivered Generation (MWh)", font: { size: 11, weight: "bold" } },
            ticks: { font: { size: 10 } },
            grid: { color: "#f1f5f9" },
            beginAtZero: true
          }
        },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const pt = ctx.raw;
                if (!pt.date) return `Ideal Benchmark: ${pt.x} kWh/m² → ${pt.y} MWh`;
                return [
                  `Date: ${pt.date}`,
                  `Insolation: ${pt.x.toFixed(2)} kWh/m²`,
                  `Actual: ${pt.y.toFixed(2)} MWh`,
                  `PR: ${pt.pr.toFixed(1)}%`,
                  `Root Cause: ${pt.diag}`
                ];
              }
            }
          }
        }
      }
    });
  }
}

function renderWeatherTable() {
  const tbody = $("weatherCorrelationRows");
  const tfoot = $("weatherCorrelationFoot");
  if (!tbody) return;

  let filtered = weatherMergedData;
  if (weatherFilterCause === "DROPS") {
    filtered = weatherMergedData.filter(d => d.isDrop);
  } else if (weatherFilterCause !== "ALL") {
    filtered = weatherMergedData.filter(d => d.causeKey === weatherFilterCause);
  }

  if ($("weatherTableCount")) $("weatherTableCount").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="p-8 text-center text-slate-400">No trading days match the selected filter criteria.</td></tr>`;
    if (tfoot) tfoot.innerHTML = "";
    return;
  }

  tbody.innerHTML = filtered.map(d => {
    const dt = new Date(d.date + "T00:00:00Z");
    const dayName = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const isLoss = d.varianceMwh < 0;
    const varColor = isLoss ? "text-rose-600 font-bold" : "text-emerald-600 font-bold";
    const cloudWidth = Math.min(100, Math.max(2, d.cloudCover));
    const prColor = d.pr >= 75 ? "text-emerald-700 font-bold" : (d.pr >= 60 ? "text-amber-700 font-semibold" : "text-rose-700 font-bold");

    return `<tr class="border-b border-slate-100 hover:bg-blue-50/40 transition">
      <td class="p-3 text-left font-mono font-bold text-slate-900">
        ${d.date} <span class="text-[10px] text-slate-400 font-normal ml-1">(${dayName})</span>
      </td>
      <td class="p-3 text-left">
        <div class="flex items-center gap-2">
          <i class="fa-solid ${d.weatherIcon} text-sm"></i>
          <div>
            <div class="font-semibold text-slate-800 leading-tight">${d.weatherDesc}</div>
            <div class="text-[10px] text-slate-400 font-medium">${d.tempMax}°C max • ${d.tempMin}°C min</div>
          </div>
        </div>
      </td>
      <td class="p-3 text-center font-bold text-amber-900 bg-amber-50/30">
        ${d.solarInsolationKwh.toFixed(2)} <span class="text-[10px] font-normal text-slate-400">kWh/m²</span>
      </td>
      <td class="p-3 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <span class="font-semibold text-slate-700">${d.cloudCover}%</span>
          <div class="w-10 bg-slate-200 rounded-full h-1.5 overflow-hidden">
            <div class="bg-slate-500 h-1.5 rounded-full" style="width: ${cloudWidth}%"></div>
          </div>
        </div>
      </td>
      <td class="p-3 text-center font-semibold ${d.precipMm > 0 ? 'text-blue-700 font-bold' : 'text-slate-400'}">
        ${d.precipMm > 0 ? `${d.precipMm} mm` : '—'}
      </td>
      <td class="p-3 text-blue-800 font-black text-sm bg-blue-50/20">
        ${d.actualMwh.toFixed(3)} <span class="text-[10px] text-slate-400 font-normal">MWh</span>
      </td>
      <td class="p-3 font-mono font-semibold text-slate-700">
        ${d.specificYield.toFixed(2)}
      </td>
      <td class="p-3 text-slate-500 font-medium">
        ${d.expectedMwh.toFixed(3)}
      </td>
      <td class="p-3 ${varColor}">
        ${isLoss ? '' : '+'}${d.varianceMwh.toFixed(2)} <span class="text-[10px] font-normal">(${d.pctDrop > 0 ? '+' : ''}${d.pctDrop}%)</span>
      </td>
      <td class="p-3 ${prColor}">
        ${d.pr.toFixed(1)}%
      </td>
      <td class="p-3 text-center">
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${d.badgeCls}" title="${d.explanation}">
          <i class="fa-solid ${d.causeIcon}"></i> ${d.causeLabel}
        </span>
      </td>
      <td class="p-3 text-center no-print">
        <button onclick="openWeatherDayModal('${d.date}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] border border-blue-200 transition cursor-pointer">
          <i class="fa-solid fa-magnifying-glass"></i> Inspect
        </button>
      </td>
    </tr>`;
  }).join("");

  // Footer Totals & Weighted Averages
  const totalActMwh = filtered.reduce((s, d) => s + d.actualMwh, 0);
  const totalExpMwh = filtered.reduce((s, d) => s + d.expectedMwh, 0);
  const totalVarMwh = totalActMwh - totalExpMwh;
  const avgInsolation = filtered.reduce((s, d) => s + d.solarInsolationKwh, 0) / filtered.length;
  const avgCloud = Math.round(filtered.reduce((s, d) => s + d.cloudCover, 0) / filtered.length);
  const totalRain = filtered.reduce((s, d) => s + d.precipMm, 0);
  const weightedPr = totalExpMwh > 0 ? (totalActMwh / (weatherSiteConfig.capacityMw * filtered.reduce((s, d) => s + d.solarInsolationKwh, 0))) * 100 : 0;

  if (tfoot) {
    tfoot.innerHTML = `<tr>
      <td class="p-3 text-left font-black">TOTAL / AVERAGE (${filtered.length} Days)</td>
      <td class="p-3 text-left text-slate-500 font-semibold">—</td>
      <td class="p-3 text-center text-amber-900 font-black">${avgInsolation.toFixed(2)} kWh/m²</td>
      <td class="p-3 text-center text-slate-700 font-bold">${avgCloud}% avg</td>
      <td class="p-3 text-center text-blue-700 font-bold">${totalRain.toFixed(1)} mm total</td>
      <td class="p-3 text-blue-900 font-black text-sm">${totalActMwh.toFixed(3)} MWh</td>
      <td class="p-3 font-mono font-bold">${(totalActMwh / weatherSiteConfig.capacityMw).toFixed(2)}</td>
      <td class="p-3 text-slate-600 font-bold">${totalExpMwh.toFixed(3)} MWh</td>
      <td class="p-3 ${totalVarMwh < 0 ? 'text-rose-700 font-black' : 'text-emerald-700 font-black'}">
        ${totalVarMwh < 0 ? '' : '+'}${totalVarMwh.toFixed(2)} MWh
      </td>
      <td class="p-3 text-indigo-900 font-black">${weightedPr.toFixed(1)}%</td>
      <td colspan="2" class="p-3 text-center text-xs font-semibold text-slate-600">
        ${filtered.filter(d => d.isDrop).length} Drops Detected
      </td>
    </tr>`;
  }
}

// Day Deep-Dive Modal
function openWeatherDayModal(dateStr) {
  const day = weatherMergedData.find(d => d.date === dateStr);
  if (!day) return;

  const m = $("weatherDayModal");
  if (!m) return;

  if ($("modalDayTitle")) {
    $("modalDayTitle").innerHTML = `Generation & Weather Breakdown: <span class="font-mono text-blue-700">${day.date}</span>`;
  }

  // 4 Cards
  if ($("modalDayWeatherCards")) {
    $("modalDayWeatherCards").innerHTML = `
      <div class="bg-amber-50/60 p-3 rounded-xl border border-amber-200">
        <span class="text-[10px] uppercase font-bold text-amber-800">Solar Insolation (GHI)</span>
        <div class="text-lg font-black text-amber-950 mt-0.5">${day.solarInsolationKwh.toFixed(2)} <span class="text-xs font-normal">kWh/m²</span></div>
        <div class="text-[10px] text-amber-700 font-semibold mt-0.5">${day.shortwaveRadiationMj} MJ/m² • ${day.sunshineHours}h sun</div>
      </div>
      <div class="bg-slate-100 p-3 rounded-xl border border-slate-200">
        <span class="text-[10px] uppercase font-bold text-slate-600">Cloud Cover</span>
        <div class="text-lg font-black text-slate-900 mt-0.5">${day.cloudCover}%</div>
        <div class="text-[10px] text-slate-500 font-semibold mt-0.5">${day.cloudCover > 60 ? 'Dense Overcast' : (day.cloudCover > 25 ? 'Partly Cloudy' : 'Clear Sky')}</div>
      </div>
      <div class="bg-blue-50/60 p-3 rounded-xl border border-blue-200">
        <span class="text-[10px] uppercase font-bold text-blue-800">Rainfall & Storms</span>
        <div class="text-lg font-black text-blue-900 mt-0.5">${day.precipMm} <span class="text-xs font-normal">mm</span></div>
        <div class="text-[10px] text-blue-700 font-semibold mt-0.5">${day.weatherDesc}</div>
      </div>
      <div class="bg-indigo-50/60 p-3 rounded-xl border border-indigo-200">
        <span class="text-[10px] uppercase font-bold text-indigo-800">Ambient Temperature</span>
        <div class="text-lg font-black text-indigo-900 mt-0.5">${day.tempMax}°C <span class="text-xs font-normal">max</span></div>
        <div class="text-[10px] text-indigo-700 font-semibold mt-0.5">Mean: ${day.tempMean}°C • Min: ${day.tempMin}°C</div>
      </div>
    `;
  }

  // Diagnostic Callout Box
  if ($("modalDayDiagnosticBox")) {
    const isDrop = day.isDrop;
    const borderCls = isDrop ? "border-rose-300 bg-rose-50/70" : "border-emerald-300 bg-emerald-50/70";
    const headingCls = isDrop ? "text-rose-900" : "text-emerald-900";
    const iconCls = isDrop ? "fa-circle-exclamation text-rose-600" : "fa-circle-check text-emerald-600";

    $("modalDayDiagnosticBox").className = `p-4 rounded-xl border ${borderCls} space-y-1.5`;
    $("modalDayDiagnosticBox").innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid ${iconCls} text-base"></i>
        <h4 class="font-extrabold text-sm ${headingCls}">Diagnostic Assessment: ${day.causeLabel}</h4>
      </div>
      <p class="text-xs text-slate-700 leading-relaxed font-medium">
        ${day.explanation}
      </p>
      <div class="flex items-center gap-4 text-xs font-semibold pt-1 text-slate-600">
        <span>Actual: <strong class="text-slate-900">${day.actualMwh.toFixed(3)} MWh</strong></span>
        <span>Expected: <strong class="text-slate-900">${day.expectedMwh.toFixed(3)} MWh</strong></span>
        <span>Performance Ratio: <strong class="${day.pr >= 75 ? 'text-emerald-700' : 'text-rose-700'}">${day.pr.toFixed(1)}%</strong></span>
        <span>Specific Yield: <strong>${day.specificYield.toFixed(2)} kWh/kWp</strong></span>
      </div>
    `;
  }

  // 96-block generation profile chart
  const dayTrades = sortedTrades().filter(t => t.date === dateStr);
  const byBlock = {};
  dayTrades.forEach(t => { byBlock[t.block] = Math.abs(t.qty || 0); });

  const blockLabels = Array.from({ length: 96 }, (_, i) => {
    const b = i + 1;
    const sH = Math.floor((b - 1) * 15 / 60);
    const sM = ((b - 1) * 15) % 60;
    return `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`;
  });
  const blockMw = Array.from({ length: 96 }, (_, i) => byBlock[i + 1] || 0);

  // Theoretical clear-sky curve for solar window (blocks 25 to 72, peak at 48)
  const theoreticalMw = Array.from({ length: 96 }, (_, i) => {
    const b = i + 1;
    if (b < 25 || b > 72) return 0;
    const progress = (b - 25) / (72 - 25); // 0 to 1
    const shape = Math.sin(progress * Math.PI);
    const psh = day.solarInsolationKwh || 5.0;
    const peakEstimate = Math.min(10.8, (psh / 6.0) * 10.5);
    return +(shape * peakEstimate).toFixed(2);
  });

  const ctx = $("modalDayBlocksChart");
  if (ctx) {
    if (modalDayChartInst) modalDayChartInst.destroy();
    modalDayChartInst = new Chart(ctx, {
      type: "line",
      data: {
        labels: blockLabels,
        datasets: [
          {
            label: "Actual Dispatched MW",
            data: blockMw,
            borderColor: "#2563eb",
            backgroundColor: "rgba(37, 99, 235, 0.18)",
            borderWidth: 2,
            fill: true,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: "Clear-Sky Benchmark Profile (MW)",
            data: theoreticalMw,
            borderColor: "#d97706",
            borderWidth: 1.5,
            borderDash: [3, 3],
            fill: false,
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            title: { display: true, text: "Time Block (15-min Intervals, 00:00 to 24:00 hrs)", font: { size: 10 } },
            ticks: { maxTicksLimit: 16, font: { size: 9 } },
            grid: { display: false }
          },
          y: {
            title: { display: true, text: "Power Output (MW)", font: { size: 10, weight: "bold" } },
            max: 12.0,
            beginAtZero: true,
            ticks: { font: { size: 9 } }
          }
        },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 10, font: { size: 10 } } }
        }
      }
    });
  }

  m.classList.remove("hidden");
}
window.openWeatherDayModal = openWeatherDayModal;

function closeWeatherDayModal() {
  const m = $("weatherDayModal");
  if (m) m.classList.add("hidden");
  if (modalDayChartInst) {
    modalDayChartInst.destroy();
    modalDayChartInst = null;
  }
}
window.closeWeatherDayModal = closeWeatherDayModal;

// Demonstration Data Generator for 14-Day Solar Operations at Khurja STPP
async function loadSampleKhurjaSolarTrades() {
  const dates = [
    { d: "2024-05-01", type: "optimal", peak: 10.4, mcp: 4200 },
    { d: "2024-05-02", type: "optimal", peak: 10.6, mcp: 4350 },
    { d: "2024-05-03", type: "optimal", peak: 10.2, mcp: 4100 },
    { d: "2024-05-04", type: "optimal", peak: 10.5, mcp: 3950 },
    { d: "2024-05-05", type: "heatwave", peak: 9.2, mcp: 5200 },
    { d: "2024-05-06", type: "cloudy", peak: 4.8, mcp: 3600 },
    { d: "2024-05-07", type: "optimal", peak: 10.3, mcp: 3800 },
    { d: "2024-05-08", type: "optimal", peak: 10.5, mcp: 4000 },
    { d: "2024-05-09", type: "optimal", peak: 10.4, mcp: 4150 },
    { d: "2024-05-10", type: "curtailment", peak: 3.5, mcp: 3100 },
    { d: "2024-05-11", type: "rain", peak: 2.8, mcp: 3400 },
    { d: "2024-05-12", type: "optimal", peak: 10.2, mcp: 4050 },
    { d: "2024-05-13", type: "optimal", peak: 10.6, mcp: 4250 },
    { d: "2024-05-14", type: "optimal", peak: 10.5, mcp: 4180 }
  ];

  const generatedTrades = [];
  dates.forEach(cfg => {
    for (let b = 1; b <= 96; b++) {
      let mw = 0;
      if (b >= 25 && b <= 72) { // 06:00 to 18:00
        const progress = (b - 25) / (72 - 25);
        const bell = Math.sin(progress * Math.PI);
        if (cfg.type === "curtailment") {
          mw = Math.min(cfg.peak, bell * 10.5); // Capped flat output due to grid backdown
        } else if (cfg.type === "rain") {
          // Storm hits at midday
          mw = b > 44 && b < 64 ? 0.6 : bell * cfg.peak;
        } else {
          mw = bell * cfg.peak;
        }
        mw = +(mw).toFixed(3);
      }
      generatedTrades.push({
        date: cfg.d,
        block: b,
        qty: -mw, // standard sell convention
        mcp: cfg.mcp + (b % 5) * 50,
        seg: "G-DAM",
        txn: "SELL"
      });
    }
  });

  pushUndoSnapshot("Load Demo Solar Records");
  state.trades = generatedTrades;
  save();
  await saveStateToIndexedDB();
  updateUndoUI();
  showUndoToast("Loaded 14-day Demo Trades (1,344 blocks)", true);

  if ($("weatherStartDate")) $("weatherStartDate").value = "2024-05-01";
  if ($("weatherEndDate")) $("weatherEndDate").value = "2024-05-14";
  if ($("tFrom")) $("tFrom").value = "2024-05-01";
  if ($("tTo")) $("tTo").value = "2024-05-14";
  if ($("heatmapDate")) $("heatmapDate").value = "2024-05-01";

  await fetchWeatherCorrelationData();
  alert("Successfully loaded 14 days of demonstration trading records for THDCIL 11 MW Khurja Solar with clear-sky, cloud attenuation, heatwave derating, monsoon rain, and grid curtailment scenarios!");
}
window.loadSampleKhurjaSolarTrades = loadSampleKhurjaSolarTrades;

// Export Weather & Generation Correlation to Excel
function exportWeatherReportExcel() {
  if (!weatherMergedData.length) {
    alert("No correlation records to export. Please fetch weather data first.");
    return;
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: Daily Correlation Ledger
  const headers = [
    ["THDCIL 11 MW FLOATING SOLAR PV PLANT — KHURJA SUPER THERMAL POWER PLANT"],
    ["DAILY SOLAR GENERATION & HISTORICAL WEATHER CORRELATION REPORT"],
    [`Station Location: ${weatherSiteConfig.locationText} (${weatherSiteConfig.lat}° N, ${weatherSiteConfig.lon}° E)`],
    [`Capacity: ${weatherSiteConfig.capacityMw} MW AC | Benchmark PR: ${weatherSiteConfig.benchmarkPr}% | Generated: ${new Date().toLocaleString()}`],
    [],
    [
      "Date", "Day", "Weather Condition", "Max Temp (°C)", "Min Temp (°C)",
      "Solar Insolation (kWh/m²)", "Solar Radiation (MJ/m²)", "Cloud Cover (%)", "Rainfall (mm)",
      "Dispatched Gen (MWh)", "Dispatched Energy (MU)", "Specific Yield (kWh/kWp)",
      "Expected Gen (MWh)", "Variance (MWh)", "Generation Drop (%)",
      "Performance Ratio (%)", "Diagnostic Root Cause", "Engineering Explanation"
    ]
  ];

  weatherMergedData.forEach(d => {
    const dt = new Date(d.date + "T00:00:00Z");
    const dayName = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    headers.push([
      d.date, dayName, d.weatherDesc, d.tempMax, d.tempMin,
      d.solarInsolationKwh, d.shortwaveRadiationMj, d.cloudCover, d.precipMm,
      d.actualMwh, d.actualMu, d.specificYield,
      d.expectedMwh, d.varianceMwh, d.pctDrop,
      d.pr, d.causeLabel, d.explanation
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(headers);
  XLSX.utils.book_append_sheet(wb, ws, "Weather_Correlation");

  // Sheet 2: Root Cause Diagnostics Summary
  const drops = weatherMergedData.filter(d => d.isDrop);
  const diagHeaders = [
    ["IDENTIFIED GENERATION DROPS & ROOT CAUSE TAXONOMY"],
    [`Total Days Analyzed: ${weatherMergedData.length} | Drop Incidents: ${drops.length}`],
    [],
    ["Date", "Root Cause Category", "Actual MWh", "Expected MWh", "Deficit (MWh)", "% Drop", "Insolation (kWh/m²)", "Cloud (%)", "Rain (mm)", "Explanation"]
  ];

  drops.forEach(d => {
    diagHeaders.push([
      d.date, d.causeLabel, d.actualMwh, d.expectedMwh, d.varianceMwh, d.pctDrop,
      d.solarInsolationKwh, d.cloudCover, d.precipMm, d.explanation
    ]);
  });

  const wsDiag = XLSX.utils.aoa_to_sheet(diagHeaders);
  XLSX.utils.book_append_sheet(wb, wsDiag, "Drop_Diagnostics");

  XLSX.writeFile(wb, `THDCIL_11MW_Solar_Weather_Correlation_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
window.exportWeatherReportExcel = exportWeatherReportExcel;

function renderWeatherCorrelation() {
  updateWeatherSiteDisplay();
  if (weatherMergedData.length === 0) {
    fetchWeatherCorrelationData();
  } else {
    renderWeatherCorrelationUI();
  }
}
window.renderWeatherCorrelation = renderWeatherCorrelation;

// ============================================================================
// YEAR-OVER-YEAR (YoY) SOLAR GENERATION & SEASONAL VARIANCE COMPARISON ENGINE
// ============================================================================

let yoyDailyChartInst = null;
let yoyDiurnalChartInst = null;
let yoyCumulativeChartInst = null;
const yoyWeatherCache = new Map();
let yoyCurrentComparisonData = null;

// Khurja STPP Floating Solar Regional Climate & Seasonal Taxonomy
const SOLAR_SEASONS = [
  {
    month: 1, name: "January", seasonName: "Winter Radiation Fog & Low Sun Angle",
    icon: "fa-smog text-sky-500", badgeClass: "bg-sky-500/20 text-sky-300 border-sky-400/30",
    ghiBenchmark: 4.0, cloudBenchmark: 40, tempBenchmark: 21,
    desc: "Short daylight hours (~10.2 hrs) and low sun zenith angle. Dense morning radiation fog in western UP delays generation ramp up to 09:30-10:00 AM (blocks 38-40). Cold ambient temperatures (8-18°C) maximize PV module open-circuit voltage and inverter efficiency during clear midday windows.",
    deratingRisk: "Low (cold air prevents thermal derating; primary variance driver is morning fog duration and aerosol haze)."
  },
  {
    month: 2, name: "February", seasonName: "Late Winter / Early Spring Transition",
    icon: "fa-cloud-sun text-indigo-400", badgeClass: "bg-indigo-500/20 text-indigo-300 border-indigo-400/30",
    ghiBenchmark: 5.3, cloudBenchmark: 25, tempBenchmark: 24,
    desc: "Radiation fog rapidly clears. Daylight expands to ~11.0 hours with ascending solar elevation. Clear blue skies and moderate temperatures provide exceptional specific yield (kWh/kWp) with minimal thermal degradation.",
    deratingRisk: "Very Low (optimal PV conversion operating temperature window)."
  },
  {
    month: 3, name: "March", seasonName: "Spring High-Efficiency Solar Ramp",
    icon: "fa-sun text-emerald-400", badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
    ghiBenchmark: 6.0, cloudBenchmark: 20, tempBenchmark: 31,
    desc: "Strong solar insolation ascent (~6.0 kWh/m²/day) with ~12.0 hours daylight. Clear atmospheric conditions result in dependable high daily generation (~55-62 MWh/day for 11 MW plant).",
    deratingRisk: "Moderate (afternoon temperatures climb above 30°C, initiating minor cell temperature derating)."
  },
  {
    month: 4, name: "April", seasonName: "Pre-Monsoon Peak Solar Summer",
    icon: "fa-sun text-amber-400", badgeClass: "bg-amber-500/20 text-amber-300 border-amber-400/30",
    ghiBenchmark: 6.7, cloudBenchmark: 15, tempBenchmark: 37,
    desc: "Near-peak annual solar irradiance and high sun elevation angle (~75° at solar noon). Daylight extends to ~12.8 hours. North-western dust storms (Andhi) and module temperature rise are the chief operational risks.",
    deratingRisk: "High (ambient temperatures reach 36-39°C; PV cells exceed 55°C, causing ~0.38%/°C voltage derating)."
  },
  {
    month: 5, name: "May", seasonName: "Pre-Monsoon Extreme Heat & High GHI",
    icon: "fa-temperature-high text-orange-400", badgeClass: "bg-orange-500/20 text-orange-300 border-orange-400/30",
    ghiBenchmark: 6.8, cloudBenchmark: 18, tempBenchmark: 41,
    desc: "Maximum annual Global Horizontal Irradiance (GHI 6.5 - 7.2 kWh/m²/day) and longest daylight hours (~13.4 hrs). Counterbalanced by severe heatwave conditions (ambient 40-44°C). The Khurja reservoir water body provides a crucial 4-6°C evaporative cooling benefit to floating modules compared to land mounts.",
    deratingRisk: "Extreme (ambient >42°C causes notable midday power flattening despite peak irradiance; major driver of YoY heatwave variances)."
  },
  {
    month: 6, name: "June", seasonName: "Monsoon Onset Window & Pre-Monsoon Squalls",
    icon: "fa-cloud-bolt text-amber-400", badgeClass: "bg-amber-500/20 text-amber-300 border-amber-400/30",
    ghiBenchmark: 6.1, cloudBenchmark: 45, tempBenchmark: 40,
    desc: "High solar potential interrupted by advancing monsoon squalls, cloud build-ups, and dust storms. Arrival timing of the Southwest monsoon front across western UP dictates whether June yields high summer generation or early cloud attenuation.",
    deratingRisk: "High to Variable (early monsoon arrival drastically drops June output by 15-30% YoY)."
  },
  {
    month: 7, name: "July", seasonName: "Southwest Monsoon Peak Cloud Attenuation",
    icon: "fa-cloud-showers-heavy text-blue-400", badgeClass: "bg-blue-500/20 text-blue-300 border-blue-400/30",
    ghiBenchmark: 4.6, cloudBenchmark: 75, tempBenchmark: 35,
    desc: "Dense monsoonal cloud decks (65-85% cloud cover) and frequent rain showers attenuate direct solar beam radiation. Diffuse radiation fraction surges to 60-70%. CUF drops to lowest annual levels (12-16%), though rain washing cleans module soiling completely.",
    deratingRisk: "Low thermal derating (rain cooling keeps panels under 35°C), but heavy optical cloud obscuration dominates."
  },
  {
    month: 8, name: "August", seasonName: "Active Southwest Monsoon",
    icon: "fa-cloud-rain text-blue-400", badgeClass: "bg-blue-500/20 text-blue-300 border-blue-400/30",
    ghiBenchmark: 4.5, cloudBenchmark: 78, tempBenchmark: 34,
    desc: "Persistent monsoon depressions. High variance between continuous overcast rain days (15-22 MWh) and intermittent 'monsoon breaks' with crisp, washed clear sky spikes (50-58 MWh).",
    deratingRisk: "Low thermal, high cloud optical thickness variance."
  },
  {
    month: 9, name: "September", seasonName: "Late Monsoon Withdrawal Transition",
    icon: "fa-cloud-sun text-teal-400", badgeClass: "bg-teal-500/20 text-teal-300 border-teal-400/30",
    ghiBenchmark: 5.3, cloudBenchmark: 45, tempBenchmark: 33,
    desc: "Monsoon withdrawal begins from North-West India. Cloud cover drops rapidly from 70% to 30%. Clean air post-rains results in sharp generation recovery as direct normal irradiance returns.",
    deratingRisk: "Low to Moderate; fast rebound in capacity utilization factor."
  },
  {
    month: 10, name: "October", seasonName: "Post-Monsoon Autumn High Clarity",
    icon: "fa-sun text-emerald-400", badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
    ghiBenchmark: 5.7, cloudBenchmark: 15, tempBenchmark: 32,
    desc: "Pristine clear skies, low humidity, and pleasant daytime temperatures (28-32°C). Provides highest system performance ratio (PR 82-84%) of the year, though day length naturally contracts to ~11.2 hours.",
    deratingRisk: "Very Low (near-optimal electrical cell conversion conditions)."
  },
  {
    month: 11, name: "November", seasonName: "Post-Monsoon / Pre-Winter Smog Window",
    icon: "fa-smog text-slate-400", badgeClass: "bg-slate-500/20 text-slate-300 border-slate-400/30",
    ghiBenchmark: 4.8, cloudBenchmark: 20, tempBenchmark: 27,
    desc: "Clear skies but descending sun elevation angle. Regional agricultural biomass burning and nocturnal temperature inversion trap atmospheric particulate matter (PM2.5/PM10) in western UP, attenuating direct solar irradiance by 8-15%.",
    deratingRisk: "Low thermal; aerosol optical depth (AOD) and smog haze are primary variance factors."
  },
  {
    month: 12, name: "December", seasonName: "Early Winter Low Sun & Fog Initiation",
    icon: "fa-snowflake text-sky-400", badgeClass: "bg-sky-500/20 text-sky-300 border-sky-400/30",
    ghiBenchmark: 4.0, cloudBenchmark: 40, tempBenchmark: 21,
    desc: "Shortest daylight window of the year (~10.0 hrs, winter solstice). Radiation fog episodes commence in the NCR/Khurja belt. Cold temperatures (6-16°C) give crisp, high-voltage generation during sunny midday hours.",
    deratingRisk: "Zero thermal derating; daylight duration and morning fog clearance dictate variance."
  }
];

function getSolarSeasonInfo(monthNumber) {
  const m = parseInt(monthNumber, 10) || 5;
  return SOLAR_SEASONS.find(x => x.month === m) || SOLAR_SEASONS[4];
}

// Fetch or retrieve cached meteorological data for a given Year-Month
async function fetchYoyMonthWeather(year, month) {
  const mStr = String(month).padStart(2, "0");
  const cacheKey = `${year}-${mStr}`;
  if (yoyWeatherCache.has(cacheKey)) return yoyWeatherCache.get(cacheKey);

  const lastDay = new Date(year, month, 0).getDate();
  const startDate = `${year}-${mStr}-01`;
  const endDate = `${year}-${mStr}-${String(lastDay).padStart(2, "0")}`;

  const lat = (typeof weatherSiteConfig !== "undefined" && weatherSiteConfig.lat) ? weatherSiteConfig.lat : 28.239;
  const lon = (typeof weatherSiteConfig !== "undefined" && weatherSiteConfig.lon) ? weatherSiteConfig.lon : 77.873;

  try {
    const url = `/api/weather?startDate=${startDate}&endDate=${endDate}&lat=${lat}&lon=${lon}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const json = await resp.json();
      if (json.success && Array.isArray(json.daily) && json.daily.length > 0) {
        yoyWeatherCache.set(cacheKey, json.daily);
        return json.daily;
      }
    }
  } catch (err) {
    console.warn("YoY Weather API fetch failed for", cacheKey, err.message);
  }

  // Fallback generation for Khurja climate
  const season = getSolarSeasonInfo(month);
  const fallback = [];
  for (let d = 1; d <= lastDay; d++) {
    const dStr = `${year}-${mStr}-${String(d).padStart(2, "0")}`;
    const seed = (d * 17 + month * 31 + (year % 10) * 11) % 100;
    const isRain = (month === 7 || month === 8) && (seed % 4 === 0);
    const isCloudy = seed % 5 === 0;
    const insolation = +(season.ghiBenchmark * (isRain ? 0.45 : isCloudy ? 0.72 : (0.9 + (seed / 100) * 0.2))).toFixed(2);
    fallback.push({
      date: dStr,
      weatherCode: isRain ? 63 : isCloudy ? 3 : 0,
      weatherDesc: isRain ? "Rain Showers" : isCloudy ? "Overcast" : "Clear Sky",
      weatherIcon: isRain ? "fa-cloud-showers-heavy text-blue-600" : isCloudy ? "fa-cloud text-slate-400" : "fa-sun text-amber-500",
      solarInsolationKwh: insolation,
      cloudCover: isRain ? 85 : isCloudy ? 70 : season.cloudBenchmark,
      precipMm: isRain ? +(12 + (seed % 30)).toFixed(1) : 0,
      tempMax: +(season.tempBenchmark + (seed % 6 - 3)).toFixed(1)
    });
  }
  yoyWeatherCache.set(cacheKey, fallback);
  return fallback;
}

// Automatically sync year options in select dropdowns based on state.trades
function initYoyYearOptions() {
  const trades = sortedTrades();
  const yearsFound = new Set();
  trades.forEach(t => {
    if (t.date && t.date.length >= 4) {
      yearsFound.add(parseInt(t.date.slice(0, 4), 10));
    }
  });

  const curSelect = $("yoyCurYearSelect");
  const compSelect = $("yoyCompYearSelect");
  if (!curSelect || !compSelect) return;

  const currentYearNow = new Date().getFullYear();
  if (yearsFound.size === 0) {
    yearsFound.add(2024);
    yearsFound.add(2023);
  } else if (yearsFound.size === 1) {
    const single = [...yearsFound][0];
    yearsFound.add(single - 1);
  }

  // Ensure current year now is available
  yearsFound.add(currentYearNow);

  const sortedYears = [...yearsFound].sort((a, b) => b - a);

  const prevCurVal = curSelect.value ? parseInt(curSelect.value, 10) : sortedYears[0];
  const prevCompVal = compSelect.value ? parseInt(compSelect.value, 10) : (prevCurVal - 1);

  curSelect.innerHTML = sortedYears.map(y => `<option value="${y}" ${y === prevCurVal ? 'selected' : ''}>${y}</option>`).join("");
  compSelect.innerHTML = sortedYears.map(y => `<option value="${y}" ${y === prevCompVal ? 'selected' : ''}>${y} (Prior Year)</option>`).join("");
}

function onYoyCurYearChange() {
  const curY = parseInt($("yoyCurYearSelect")?.value, 10) || 2024;
  const compSelect = $("yoyCompYearSelect");
  if (compSelect) {
    compSelect.value = String(curY - 1);
    if (!compSelect.value) {
      // If curY - 1 is not in options, append it
      compSelect.innerHTML += `<option value="${curY - 1}" selected>${curY - 1} (Prior Year)</option>`;
      compSelect.value = String(curY - 1);
    }
  }
  renderYoyComparison();
}
window.onYoyCurYearChange = onYoyCurYearChange;

// Main Year-over-Year Comparison Calculation & Rendering Routine
async function renderYoyComparison() {
  initYoyYearOptions();

  const mVal = parseInt($("yoyMonthSelect")?.value, 10) || 5;
  const curYear = parseInt($("yoyCurYearSelect")?.value, 10) || 2024;
  const compYear = parseInt($("yoyCompYearSelect")?.value, 10) || 2023;
  const segFilter = $("yoySegSelect")?.value || "ALL";

  const seasonInfo = getSolarSeasonInfo(mVal);

  // Update Section Header Context
  if ($("yoySeasonBadge")) {
    $("yoySeasonBadge").className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${seasonInfo.badgeClass} flex items-center gap-1`;
    $("yoySeasonBadge").innerHTML = `<i class="fa-solid ${seasonInfo.icon}"></i> ${seasonInfo.seasonName}`;
  }
  if ($("yoyHeaderTitle")) {
    $("yoyHeaderTitle").innerText = `${seasonInfo.name} ${curYear} vs ${seasonInfo.name} ${compYear} Solar Generation Comparison`;
  }
  if ($("yoySeasonDescription")) {
    $("yoySeasonDescription").innerText = `${seasonInfo.desc} (${seasonInfo.deratingRisk})`;
  }

  // Filter trades for both periods
  const mPrefix = String(mVal).padStart(2, "0");
  const curPrefix = `${curYear}-${mPrefix}`;
  const compPrefix = `${compYear}-${mPrefix}`;

  let allTrades = sortedTrades();
  if (segFilter !== "ALL") {
    allTrades = allTrades.filter(t => (t.seg || "G-DAM") === segFilter);
  }

  const curTrades = allTrades.filter(t => t.date && t.date.startsWith(curPrefix));
  const compTrades = allTrades.filter(t => t.date && t.date.startsWith(compPrefix));

  // Toggle Missing Data Alert
  const missingBanner = $("yoyMissingDataBanner");
  if (missingBanner) {
    if (compTrades.length === 0) {
      missingBanner.classList.remove("hidden");
      if ($("yoyMissingDataTitle")) $("yoyMissingDataTitle").innerText = `No Historical Trades for ${seasonInfo.name} ${compYear}`;
      if ($("yoyMissingDataText")) $("yoyMissingDataText").innerHTML = `Trade records for comparison year <strong>${seasonInfo.name} ${compYear}</strong> are not yet loaded. You can click <strong>Load Prior Year Baseline</strong> below to immediately populate benchmark 11 MW Khurja solar generation records for ${seasonInfo.name} ${compYear} and analyze seasonal variances!`;
    } else {
      missingBanner.classList.add("hidden");
    }
  }

  // Days in month
  const totalDaysInMonth = new Date(curYear, mVal, 0).getDate();

  // Aggregate daily records
  const curDailyMap = new Map();
  const compDailyMap = new Map();

  // 96-block diurnal profile accumulator
  const curBlockSums = new Array(97).fill(0);
  const curBlockCounts = new Array(97).fill(0);
  const compBlockSums = new Array(97).fill(0);
  const compBlockCounts = new Array(97).fill(0);

  curTrades.forEach(t => {
    const day = parseInt(t.date.slice(8, 10), 10);
    if (!curDailyMap.has(day)) curDailyMap.set(day, { date: t.date, mwh: 0, rev: 0, maxMw: 0, blocks: [], mcpSum: 0 });
    const rec = curDailyMap.get(day);
    const mw = Math.abs(t.qty || 0);
    const qMwh = mw * 0.25;
    rec.mwh += qMwh;
    rec.rev += amount(t);
    rec.mcpSum += (t.mcp || 0) * qMwh;
    if (mw > rec.maxMw) rec.maxMw = mw;
    rec.blocks.push(t);

    const b = parseInt(t.block, 10);
    if (b >= 1 && b <= 96) {
      curBlockSums[b] += mw;
      curBlockCounts[b]++;
    }
  });

  compTrades.forEach(t => {
    const day = parseInt(t.date.slice(8, 10), 10);
    if (!compDailyMap.has(day)) compDailyMap.set(day, { date: t.date, mwh: 0, rev: 0, maxMw: 0, blocks: [], mcpSum: 0 });
    const rec = compDailyMap.get(day);
    const mw = Math.abs(t.qty || 0);
    const qMwh = mw * 0.25;
    rec.mwh += qMwh;
    rec.rev += amount(t);
    rec.mcpSum += (t.mcp || 0) * qMwh;
    if (mw > rec.maxMw) rec.maxMw = mw;
    rec.blocks.push(t);

    const b = parseInt(t.block, 10);
    if (b >= 1 && b <= 96) {
      compBlockSums[b] += mw;
      compBlockCounts[b]++;
    }
  });

  // Fetch weather data for both years
  const curWeather = await fetchYoyMonthWeather(curYear, mVal);
  const compWeather = await fetchYoyMonthWeather(compYear, mVal);

  const curWeatherMap = new Map(curWeather.map(w => [parseInt(w.date.slice(8, 10), 10), w]));
  const compWeatherMap = new Map(compWeather.map(w => [parseInt(w.date.slice(8, 10), 10), w]));

  // Aggregate Totals
  const curActiveDays = curDailyMap.size;
  const compActiveDays = compDailyMap.size;

  const curTotalMwh = [...curDailyMap.values()].reduce((s, d) => s + d.mwh, 0);
  const compTotalMwh = [...compDailyMap.values()].reduce((s, d) => s + d.mwh, 0);

  const curTotalRev = [...curDailyMap.values()].reduce((s, d) => s + d.rev, 0);
  const compTotalRev = [...compDailyMap.values()].reduce((s, d) => s + d.rev, 0);

  const curPeakMw = curTrades.reduce((mx, t) => Math.max(mx, Math.abs(t.qty || 0)), 0);
  const compPeakMw = compTrades.reduce((mx, t) => Math.max(mx, Math.abs(t.qty || 0)), 0);

  // Accurate CUF calculation for 11 MW: Energy / (11 MW * 24 h * activeDays) * 100
  const curCuf = curActiveDays > 0 ? (curTotalMwh / (11.0 * 24 * curActiveDays)) * 100 : 0;
  const compCuf = compActiveDays > 0 ? (compTotalMwh / (11.0 * 24 * compActiveDays)) * 100 : 0;

  const curDailyAvg = curActiveDays > 0 ? curTotalMwh / curActiveDays : 0;
  const compDailyAvg = compActiveDays > 0 ? compTotalMwh / compActiveDays : 0;

  const curMcpWeighted = curTotalMwh > 0 ? curTotalRev / curTotalMwh : 0;
  const compMcpWeighted = compTotalMwh > 0 ? compTotalRev / compTotalMwh : 0;

  // Weather Averages
  const curAvgGhi = curWeather.length ? curWeather.reduce((s, w) => s + (w.solarInsolationKwh || 0), 0) / curWeather.length : seasonInfo.ghiBenchmark;
  const compAvgGhi = compWeather.length ? compWeather.reduce((s, w) => s + (w.solarInsolationKwh || 0), 0) / compWeather.length : seasonInfo.ghiBenchmark;

  const curAvgCloud = curWeather.length ? Math.round(curWeather.reduce((s, w) => s + (w.cloudCover || 0), 0) / curWeather.length) : seasonInfo.cloudBenchmark;
  const compAvgCloud = compWeather.length ? Math.round(compWeather.reduce((s, w) => s + (w.cloudCover || 0), 0) / compWeather.length) : seasonInfo.cloudBenchmark;

  const curAvgTemp = curWeather.length ? +(curWeather.reduce((s, w) => s + (w.tempMax || 0), 0) / curWeather.length).toFixed(1) : seasonInfo.tempBenchmark;
  const compAvgTemp = compWeather.length ? +(compWeather.reduce((s, w) => s + (w.tempMax || 0), 0) / compWeather.length).toFixed(1) : seasonInfo.tempBenchmark;

  const curRainDays = curWeather.filter(w => (w.precipMm || 0) >= 1.0).length;
  const compRainDays = compWeather.filter(w => (w.precipMm || 0) >= 1.0).length;

  // Variances
  const deltaMwh = curTotalMwh - compTotalMwh;
  const pctMwh = compTotalMwh > 0 ? ((deltaMwh / compTotalMwh) * 100) : (curTotalMwh > 0 ? 100 : 0);
  const deltaCuf = curCuf - compCuf;
  const deltaPeak = curPeakMw - compPeakMw;
  const deltaGhi = curAvgGhi - compAvgGhi;
  const pctGhi = compAvgGhi > 0 ? ((deltaGhi / compAvgGhi) * 100) : 0;
  const deltaCloud = curAvgCloud - compAvgCloud;
  const deltaTemp = curAvgTemp - compAvgTemp;
  const deltaRev = curTotalRev - compTotalRev;
  const pctRev = compTotalRev > 0 ? ((deltaRev / compTotalRev) * 100) : 0;
  const deltaMcp = curMcpWeighted - compMcpWeighted;

  // Store computation data for table search and Excel export
  yoyCurrentComparisonData = {
    monthNumber: mVal,
    monthName: seasonInfo.name,
    curYear,
    compYear,
    seasonInfo,
    curTotalMwh,
    compTotalMwh,
    deltaMwh,
    pctMwh,
    curCuf,
    compCuf,
    deltaCuf,
    curDailyAvg,
    compDailyAvg,
    curPeakMw,
    compPeakMw,
    curTotalRev,
    compTotalRev,
    deltaRev,
    curMcpWeighted,
    compMcpWeighted,
    deltaMcp,
    curAvgGhi,
    compAvgGhi,
    deltaGhi,
    pctGhi,
    curAvgCloud,
    compAvgCloud,
    deltaCloud,
    curAvgTemp,
    compAvgTemp,
    deltaTemp,
    curRainDays,
    compRainDays,
    curActiveDays,
    compActiveDays,
    curDailyMap,
    compDailyMap,
    curWeatherMap,
    compWeatherMap,
    curBlockSums,
    curBlockCounts,
    compBlockSums,
    compBlockCounts,
    totalDaysInMonth
  };

  // 1. Executive Summary & Diagnostic Badges
  if ($("yoyHeadlineSummary")) {
    const isGain = deltaMwh >= 0;
    const sign = isGain ? "+" : "";
    $("yoyHeadlineSummary").innerHTML = compTotalMwh > 0 ? `
      ${seasonInfo.name} ${curYear} Dispatched <span class="${isGain ? 'text-emerald-700' : 'text-rose-700'} font-black">${curTotalMwh.toFixed(2)} MWh</span>
      (${sign}${deltaMwh.toFixed(2)} MWh / ${sign}${pctMwh.toFixed(1)}%) vs ${seasonInfo.name} ${compYear} (${compTotalMwh.toFixed(2)} MWh)
    ` : `
      ${seasonInfo.name} ${curYear} Dispatched <span class="text-blue-700 font-black">${curTotalMwh.toFixed(2)} MWh</span> Across ${curActiveDays} Days
    `;
  }

  if ($("yoyPeriodSubtitle")) {
    $("yoyPeriodSubtitle").innerText = `Comparison Period: ${curActiveDays} active days in ${curYear} vs ${compActiveDays} active days in ${compYear} • Plant Capacity: 11.0 MW AC`;
  }

  // Diagnostic Badges
  if ($("yoyDiagnosticPills")) {
    const badges = [];
    if (deltaMwh >= 0) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1"><i class="fa-solid fa-arrow-trend-up"></i> +${pctMwh.toFixed(1)}% YoY Generation Gain</span>`);
    } else {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1"><i class="fa-solid fa-arrow-trend-down"></i> ${pctMwh.toFixed(1)}% YoY Deficit</span>`);
    }

    if (deltaCuf >= 0.5) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300"><i class="fa-solid fa-bolt"></i> +${deltaCuf.toFixed(2)}% CUF Outperformance</span>`);
    } else if (deltaCuf <= -0.5) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300"><i class="fa-solid fa-triangle-exclamation"></i> ${deltaCuf.toFixed(2)}% CUF Contraction</span>`);
    }

    if (deltaGhi >= 0.2) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300"><i class="fa-solid fa-sun text-amber-500"></i> +${pctGhi.toFixed(1)}% Higher Irradiance</span>`);
    } else if (deltaGhi <= -0.2) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300"><i class="fa-solid fa-cloud text-sky-500"></i> Cloud Cover Attenuation</span>`);
    }

    if (deltaTemp >= 1.5 && (mVal >= 4 && mVal <= 6)) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300"><i class="fa-solid fa-temperature-high text-rose-600"></i> Extreme Heat Derating (+${deltaTemp.toFixed(1)}°C)</span>`);
    }

    if (curRainDays !== compRainDays) {
      badges.push(`<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300"><i class="fa-solid fa-cloud-showers-heavy"></i> ${curRainDays} vs ${compRainDays} Rain Days</span>`);
    }

    $("yoyDiagnosticPills").innerHTML = badges.join("");
  }

  // 4 Seasonal Drivers
  if ($("yoyDriverGhiBadge")) {
    const s = deltaGhi >= 0 ? "+" : "";
    $("yoyDriverGhiBadge").innerText = `${s}${pctGhi.toFixed(1)}%`;
    $("yoyDriverGhiBadge").className = `font-mono text-[11px] font-extrabold px-1.5 py-0.5 rounded ${deltaGhi >= 0 ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-800'}`;
  }
  if ($("yoyDriverGhiText")) {
    const s = deltaGhi >= 0 ? "+" : "";
    $("yoyDriverGhiText").innerText = `Mean GHI: ${curAvgGhi.toFixed(2)} vs ${compAvgGhi.toFixed(2)} kWh/m²/day (${s}${deltaGhi.toFixed(2)} kWh/m² difference).`;
  }

  if ($("yoyDriverCloudBadge")) {
    const s = deltaCloud >= 0 ? "+" : "";
    $("yoyDriverCloudBadge").innerText = `${s}${deltaCloud}%`;
    $("yoyDriverCloudBadge").className = `font-mono text-[11px] font-extrabold px-1.5 py-0.5 rounded ${deltaCloud <= 0 ? 'bg-emerald-200 text-emerald-900' : 'bg-sky-200 text-sky-900'}`;
  }
  if ($("yoyDriverCloudText")) {
    $("yoyDriverCloudText").innerText = `Mean cloud cover was ${curAvgCloud}% in ${curYear} vs ${compAvgCloud}% in ${compYear} (${curRainDays} vs ${compRainDays} precipitation days).`;
  }

  if ($("yoyDriverTempBadge")) {
    const s = deltaTemp >= 0 ? "+" : "";
    $("yoyDriverTempBadge").innerText = `${s}${deltaTemp.toFixed(1)}°C`;
    $("yoyDriverTempBadge").className = `font-mono text-[11px] font-extrabold px-1.5 py-0.5 rounded ${deltaTemp > 1.0 ? 'bg-rose-200 text-rose-900' : 'bg-slate-200 text-slate-800'}`;
  }
  if ($("yoyDriverTempText")) {
    const thermalDeratingPct = deltaTemp * 0.38; // ~0.38% per deg C
    const penaltyDesc = deltaTemp > 1.0 ? `estimated ~${thermalDeratingPct.toFixed(1)}% voltage derating loss` : 'normal temperature variance';
    $("yoyDriverTempText").innerText = `Average Tmax: ${curAvgTemp}°C vs ${compAvgTemp}°C (${penaltyDesc}).`;
  }

  if ($("yoyDriverPriceBadge")) {
    const s = deltaMcp >= 0 ? "+" : "";
    $("yoyDriverPriceBadge").innerText = `${s}₹${(deltaMcp / 1000).toFixed(2)}/kWh`;
    $("yoyDriverPriceBadge").className = `font-mono text-[11px] font-extrabold px-1.5 py-0.5 rounded ${deltaMcp >= 0 ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}`;
  }
  if ($("yoyDriverPriceText")) {
    const s = deltaMcp >= 0 ? "+" : "";
    $("yoyDriverPriceText").innerText = `Weighted MCP: ₹${curMcpWeighted.toFixed(0)} vs ₹${compMcpWeighted.toFixed(0)}/MWh (${s}₹${deltaMcp.toFixed(0)} difference).`;
  }

  // 2. Render 9 Comparative KPI Cards
  renderYoyKpis(curYear, compYear, {
    curTotalMwh, compTotalMwh, deltaMwh, pctMwh,
    curCuf, compCuf, deltaCuf,
    curDailyAvg, compDailyAvg,
    curPeakMw, compPeakMw, deltaPeak,
    curAvgGhi, compAvgGhi, deltaGhi, pctGhi,
    curAvgCloud, compAvgCloud, deltaCloud, curRainDays, compRainDays,
    curAvgTemp, compAvgTemp, deltaTemp,
    curTotalRev, compTotalRev, deltaRev, pctRev,
    curMcpWeighted, compMcpWeighted, deltaMcp
  });

  // 3. Render Visualizations
  renderYoyDailyGenChart(curYear, compYear, totalDaysInMonth, curDailyMap, compDailyMap, curWeatherMap, compWeatherMap);
  renderYoyCumulativeGenChart(curYear, compYear, totalDaysInMonth, curDailyMap, compDailyMap);
  renderYoyDiurnalProfileChart(curYear, compYear, curBlockSums, curBlockCounts, compBlockSums, compBlockCounts, curActiveDays, compActiveDays);

  // 4. Render Day-by-Day Reconciliation Table
  renderYoyTable(curYear, compYear, totalDaysInMonth, curDailyMap, compDailyMap, curWeatherMap, compWeatherMap, seasonInfo);
}
window.renderYoyComparison = renderYoyComparison;

// Render 9 Comparative Side-by-Side KPI Cards
function renderYoyKpis(curYear, compYear, d) {
  const container = $("yoyKpiGrid");
  if (!container) return;

  function deltaPill(delta, pct, unit="", higherIsBetter=true) {
    if (isNaN(delta) || !isFinite(delta)) return `<span class="text-[10px] text-slate-400">N/A</span>`;
    const isZero = Math.abs(delta) < 0.001;
    if (isZero) return `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-600">Equal (0.0%)</span>`;
    const isPositive = delta > 0;
    const isGood = higherIsBetter ? isPositive : !isPositive;
    const color = isGood ? 'emerald' : 'rose';
    const sign = isPositive ? "+" : "";
    const pctStr = pct !== null && isFinite(pct) ? ` (${sign}${pct.toFixed(1)}%)` : '';
    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-${color}-100 text-${color}-800 border border-${color}-200 flex items-center gap-1">
      <i class="fa-solid fa-arrow-${isPositive ? 'up' : 'down'} text-[9px]"></i> ${sign}${delta.toFixed(2)}${unit}${pctStr}
    </span>`;
  }

  const kpis = [
    {
      title: "Total Generation (MWh)",
      icon: "fa-bolt text-blue-600",
      curVal: `${d.curTotalMwh.toFixed(2)} MWh`,
      curSub: `${(d.curTotalMwh / 1000).toFixed(3)} MU`,
      compVal: `${d.compTotalMwh.toFixed(2)} MWh`,
      compSub: `${(d.compTotalMwh / 1000).toFixed(3)} MU in ${compYear}`,
      pill: deltaPill(d.deltaMwh, d.pctMwh, " MWh", true)
    },
    {
      title: "Capacity Utilization Factor (CUF)",
      icon: "fa-chart-pie text-teal-600",
      curVal: `${d.curCuf.toFixed(2)}%`,
      curSub: "11 MW AC Installed Base",
      compVal: `${d.compCuf.toFixed(2)}%`,
      compSub: `Prior year benchmark`,
      pill: deltaPill(d.deltaCuf, null, "% pts", true)
    },
    {
      title: "Daily Average Generation",
      icon: "fa-calendar-day text-indigo-600",
      curVal: `${d.curDailyAvg.toFixed(2)} MWh/d`,
      curSub: "Mean daily energy yield",
      compVal: `${d.compDailyAvg.toFixed(2)} MWh/d`,
      compSub: `in ${compYear}`,
      pill: deltaPill(d.curDailyAvg - d.compDailyAvg, d.compDailyAvg > 0 ? ((d.curDailyAvg - d.compDailyAvg) / d.compDailyAvg) * 100 : 0, " MWh/d", true)
    },
    {
      title: "Peak Dispatched Output",
      icon: "fa-solar-panel text-amber-500",
      curVal: `${d.curPeakMw.toFixed(2)} MW`,
      curSub: "Max 15-min scheduled power",
      compVal: `${d.compPeakMw.toFixed(2)} MW`,
      compSub: `Prior year peak`,
      pill: deltaPill(d.deltaPeak, null, " MW", true)
    },
    {
      title: "Mean Solar Insolation (GHI)",
      icon: "fa-sun text-amber-500",
      curVal: `${d.curAvgGhi.toFixed(2)} kWh/m²`,
      curSub: "Peak Sun Hours / day",
      compVal: `${d.compAvgGhi.toFixed(2)} kWh/m²`,
      compSub: `in ${compYear}`,
      pill: deltaPill(d.deltaGhi, d.pctGhi, " kWh/m²", true)
    },
    {
      title: "Mean Cloud Cover & Rain",
      icon: "fa-cloud-showers-heavy text-sky-600",
      curVal: `${d.curAvgCloud}% Cloud`,
      curSub: `${d.curRainDays} rainy day${d.curRainDays === 1 ? '' : 's'}`,
      compVal: `${d.compAvgCloud}% Cloud`,
      compSub: `${d.compRainDays} rain days in ${compYear}`,
      pill: deltaPill(d.deltaCloud, null, "%", false)
    },
    {
      title: "Max Ambient Temperature",
      icon: "fa-temperature-high text-rose-500",
      curVal: `${d.curAvgTemp}°C`,
      curSub: "PV Thermal Derating Driver",
      compVal: `${d.compAvgTemp}°C`,
      compSub: `Prior year mean Tmax`,
      pill: deltaPill(d.deltaTemp, null, "°C", false)
    },
    {
      title: "Gross Market Revenue",
      icon: "fa-indian-rupee-sign text-emerald-600",
      curVal: money(d.curTotalRev),
      curSub: `₹${(d.curTotalRev / 100000).toFixed(2)} Lakhs`,
      compVal: money(d.compTotalRev),
      compSub: `in ${compYear}`,
      pill: deltaPill(d.deltaRev, d.pctRev, "", true)
    },
    {
      title: "Volume-Weighted MCP",
      icon: "fa-scale-balanced text-purple-600",
      curVal: `₹${d.curMcpWeighted.toFixed(2)}/MWh`,
      curSub: `₹${(d.curMcpWeighted / 1000).toFixed(3)}/kWh net`,
      compVal: `₹${d.compMcpWeighted.toFixed(2)}/MWh`,
      compSub: `Prior year clearing price`,
      pill: deltaPill(d.deltaMcp, d.compMcpWeighted > 0 ? ((d.deltaMcp / d.compMcpWeighted) * 100) : 0, "/MWh", true)
    }
  ];

  container.innerHTML = kpis.map(x => `
    <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/90 flex flex-col justify-between hover:border-blue-400 hover:shadow transition space-y-3">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">${x.title}</p>
          <div class="flex items-baseline gap-2 mt-1">
            <h4 class="text-xl font-black text-slate-900">${x.curVal}</h4>
          </div>
          <p class="text-[10px] font-semibold text-slate-400">${x.curSub}</p>
        </div>
        <div class="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-base shrink-0">
          <i class="fa-solid ${x.icon}"></i>
        </div>
      </div>

      <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
        <div>
          <span class="text-[10px] font-bold text-slate-400 block">${compYear} Benchmark:</span>
          <span class="font-bold text-slate-700 text-xs">${x.compVal}</span>
        </div>
        <div>
          ${x.pill}
        </div>
      </div>
    </div>
  `).join("");
}

// Chart 1: Day-by-Day Generation Comparison (Day 1 to 31)
function renderYoyDailyGenChart(curYear, compYear, totalDays, curMap, compMap, curWeatherMap, compWeatherMap) {
  const canvas = $("yoyDailyGenChart");
  if (!canvas) return;

  if (yoyDailyChartInst) {
    yoyDailyChartInst.destroy();
    yoyDailyChartInst = null;
  }

  const labels = [];
  const curData = [];
  const compData = [];
  const curGhiData = [];

  for (let d = 1; d <= totalDays; d++) {
    labels.push(`Day ${d}`);
    const c = curMap.get(d);
    const p = compMap.get(d);
    const cw = curWeatherMap.get(d);

    curData.push(c ? +c.mwh.toFixed(2) : 0);
    compData.push(p ? +p.mwh.toFixed(2) : 0);
    curGhiData.push(cw ? +cw.solarInsolationKwh.toFixed(2) : null);
  }

  yoyDailyChartInst = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: `${curYear} Generation (MWh)`,
          data: curData,
          backgroundColor: "#2563eb",
          borderRadius: 4,
          order: 2
        },
        {
          label: `${compYear} Generation (MWh)`,
          data: compData,
          backgroundColor: "#10b981",
          borderRadius: 4,
          order: 3
        },
        {
          label: `${curYear} Solar GHI (kWh/m²)`,
          data: curGhiData,
          type: "line",
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: "yGhi",
          tension: 0.25,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 } }
        },
        y: {
          title: { display: true, text: "Generation (MWh)", font: { size: 10, weight: "bold" } },
          suggestedMax: 70
        },
        yGhi: {
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Insolation (kWh/m²)", font: { size: 10, weight: "bold" } },
          suggestedMax: 8
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: { boxWidth: 10, font: { size: 11, weight: "bold" } }
        },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const dIndex = items[0].dataIndex;
              const curMwh = curData[dIndex] || 0;
              const compMwh = compData[dIndex] || 0;
              const diff = curMwh - compMwh;
              const sign = diff >= 0 ? "+" : "";
              const pct = compMwh > 0 ? ((diff / compMwh) * 100).toFixed(1) : "0.0";
              return `Variance: ${sign}${diff.toFixed(2)} MWh (${sign}${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// Chart 2: Cumulative Energy Trajectory
function renderYoyCumulativeGenChart(curYear, compYear, totalDays, curMap, compMap) {
  const canvas = $("yoyCumulativeGenChart");
  if (!canvas) return;

  if (yoyCumulativeChartInst) {
    yoyCumulativeChartInst.destroy();
    yoyCumulativeChartInst = null;
  }

  const labels = [];
  const curCum = [];
  const compCum = [];

  let sumCur = 0;
  let sumComp = 0;

  for (let d = 1; d <= totalDays; d++) {
    labels.push(`Day ${d}`);
    const c = curMap.get(d);
    const p = compMap.get(d);

    if (c) sumCur += c.mwh;
    if (p) sumComp += p.mwh;

    curCum.push(c ? +sumCur.toFixed(2) : null);
    compCum.push(p ? +sumComp.toFixed(2) : null);
  }

  yoyCumulativeChartInst = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${curYear} Cumulative (MWh)`,
          data: curCum,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.08)",
          fill: true,
          borderWidth: 2.5,
          pointRadius: 2,
          tension: 0.2
        },
        {
          label: `${compYear} Cumulative (MWh)`,
          data: compCum,
          borderColor: "#10b981",
          backgroundColor: "transparent",
          borderDash: [5, 4],
          borderWidth: 2.5,
          pointRadius: 2,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 9 }, maxTicksLimit: 10 }
        },
        y: {
          title: { display: true, text: "Cumulative MWh", font: { size: 10, weight: "bold" } }
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: { boxWidth: 10, font: { size: 10, weight: "bold" } }
        }
      }
    }
  });
}

// Chart 3: Diurnal 96-Block Generation Profile Comparison (Solar Noon Curve)
function renderYoyDiurnalProfileChart(curYear, compYear, curSums, curCounts, compSums, compCounts, curActiveDays, compActiveDays) {
  const canvas = $("yoyDiurnalProfileChart");
  if (!canvas) return;

  if (yoyDiurnalChartInst) {
    yoyDiurnalChartInst.destroy();
    yoyDiurnalChartInst = null;
  }

  const labels = [];
  const curProfile = [];
  const compProfile = [];

  for (let b = 1; b <= 96; b++) {
    const startMin = (b - 1) * 15;
    const h = String(Math.floor(startMin / 60)).padStart(2, "0");
    const m = String(startMin % 60).padStart(2, "0");
    labels.push(`${h}:${m}`);

    const curAvg = curCounts[b] > 0 ? +(curSums[b] / curCounts[b]).toFixed(3) : 0;
    const compAvg = compCounts[b] > 0 ? +(compSums[b] / compCounts[b]).toFixed(3) : 0;

    curProfile.push(curAvg);
    compProfile.push(compAvg);
  }

  yoyDiurnalChartInst = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${curYear} Diurnal Average (MW)`,
          data: curProfile,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          fill: true,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3
        },
        {
          label: `${compYear} Diurnal Average (MW)`,
          data: compProfile,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.08)",
          fill: true,
          borderDash: [4, 4],
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 16,
            font: { size: 10 }
          },
          grid: { display: false }
        },
        y: {
          title: { display: true, text: "Average Power (MW)", font: { size: 10, weight: "bold" } },
          suggestedMax: 11.5,
          ticks: {
            callback: v => `${v} MW`
          }
        }
      },
      plugins: {
        legend: {
          position: "top",
          labels: { boxWidth: 10, font: { size: 11, weight: "bold" } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(3)} MW`
          }
        }
      }
    }
  });
}

// Render Detailed Day-by-Day Table
function renderYoyTable(curYear, compYear, totalDays, curMap, compMap, curWeatherMap, compWeatherMap, seasonInfo) {
  const tbody = $("yoyTableRows");
  const tfoot = $("yoyTableFoot");
  if (!tbody || !tfoot) return;

  if ($("yoyThCurDate")) $("yoyThCurDate").innerText = `${curYear} Date`;
  if ($("yoyThCompDate")) $("yoyThCompDate").innerText = `${compYear} Date`;

  const rows = [];
  let totCurMwh = 0;
  let totCompMwh = 0;
  let totDiff = 0;

  for (let d = 1; d <= totalDays; d++) {
    const cur = curMap.get(d);
    const comp = compMap.get(d);
    const cw = curWeatherMap.get(d);
    const pw = compWeatherMap.get(d);

    const curMwh = cur ? cur.mwh : 0;
    const compMwh = comp ? comp.mwh : 0;
    const curPeak = cur ? cur.maxMw : 0;
    const compPeak = comp ? comp.maxMw : 0;

    totCurMwh += curMwh;
    totCompMwh += compMwh;

    const diff = curMwh - compMwh;
    totDiff += diff;

    const hasData = curMwh > 0 || compMwh > 0;
    if (!hasData) continue;

    const pct = compMwh > 0 ? ((diff / compMwh) * 100) : (curMwh > 0 ? 100 : 0);
    const sign = diff >= 0 ? "+" : "";

    // Seasonal variance diagnostic note
    let note = "Normal operational parity";
    if (cw && cw.precipMm >= 5.0) {
      note = `Rain obscuration (${cw.precipMm} mm) suppressed generation`;
    } else if (cw && cw.cloudCover >= 65) {
      note = `Cloud attenuation (${cw.cloudCover}% cloud deck) caused solar drop`;
    } else if (cw && cw.tempMax >= 42.0 && seasonInfo.month === 5) {
      note = `Extreme heatwave (${cw.tempMax}°C) caused ~${((cw.tempMax - 25) * 0.38).toFixed(1)}% thermal voltage derating`;
    } else if (diff > 5.0 && cw && cw.solarInsolationKwh >= 6.5) {
      note = `Clear sky radiation surplus (+${(cw.solarInsolationKwh - (pw ? pw.solarInsolationKwh : 6.0)).toFixed(1)} kWh/m² GHI)`;
    } else if (diff < -5.0 && (pw ? pw.solarInsolationKwh : 6.0) >= 6.5) {
      note = `Prior year experienced higher clear sky window`;
    } else if (Math.abs(pct) <= 4.0) {
      note = `Seasonal parity (±${Math.abs(pct).toFixed(1)}% variance)`;
    }

    const curDateStr = cur ? cur.date : `${curYear}-${String(seasonInfo.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const compDateStr = comp ? comp.date : `${compYear}-${String(seasonInfo.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const ghiBadge = cw ? `
      <span class="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-amber-700">
        <i class="fa-solid ${cw.weatherIcon || 'fa-sun text-amber-500'}"></i> ${cw.solarInsolationKwh.toFixed(1)}
      </span>
    ` : `<span class="text-slate-400 font-mono">-</span>`;

    const diffBadge = compMwh > 0 ? `
      <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${diff >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
        ${sign}${pct.toFixed(1)}%
      </span>
    ` : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">New (${curYear})</span>`;

    rows.push(`
      <tr class="hover:bg-slate-50 transition yoy-data-row" data-day="${d}" data-note="${note.toLowerCase()}">
        <td class="p-3 text-left font-bold text-slate-800">Day ${String(d).padStart(2, "0")}</td>
        <td class="p-3 font-mono text-slate-600 text-xs">${curDateStr}</td>
        <td class="p-3 font-extrabold text-blue-700">${curMwh > 0 ? curMwh.toFixed(2) : '-'}</td>
        <td class="p-3 font-bold text-slate-700">${curPeak > 0 ? curPeak.toFixed(2) : '-'}</td>
        <td class="p-3 font-mono text-slate-600 text-xs">${compDateStr}</td>
        <td class="p-3 font-extrabold text-emerald-700">${compMwh > 0 ? compMwh.toFixed(2) : '-'}</td>
        <td class="p-3 font-bold text-slate-700">${compPeak > 0 ? compPeak.toFixed(2) : '-'}</td>
        <td class="p-3 font-mono font-black ${diff >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${sign}${diff.toFixed(2)}</td>
        <td class="p-3 text-center">${diffBadge}</td>
        <td class="p-3 text-center">${ghiBadge}</td>
        <td class="p-3 text-left text-slate-600 font-medium">${note}</td>
      </tr>
    `);
  }

  tbody.innerHTML = rows.join("") || `<tr><td colspan="11" class="p-6 text-center text-slate-400">No trading records found for the selected month in either year.</td></tr>`;

  const totalPct = totCompMwh > 0 ? ((totDiff / totCompMwh) * 100) : (totCurMwh > 0 ? 100 : 0);
  const totalSign = totDiff >= 0 ? "+" : "";

  tfoot.innerHTML = `
    <tr>
      <td class="p-3 text-left">Monthly Total</td>
      <td class="p-3">-</td>
      <td class="p-3 text-blue-700">${totCurMwh.toFixed(2)}</td>
      <td class="p-3">-</td>
      <td class="p-3">-</td>
      <td class="p-3 text-emerald-700">${totCompMwh.toFixed(2)}</td>
      <td class="p-3">-</td>
      <td class="p-3 ${totDiff >= 0 ? 'text-emerald-800' : 'text-rose-800'}">${totalSign}${totDiff.toFixed(2)}</td>
      <td class="p-3 text-center">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${totDiff >= 0 ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}">
          ${totalSign}${totalPct.toFixed(1)}%
        </span>
      </td>
      <td class="p-3 text-center">-</td>
      <td class="p-3 text-left font-bold text-slate-700">Net Monthly Variance Reconciliation</td>
    </tr>
  `;
}

function filterYoyTable(query) {
  const q = (query || "").trim().toLowerCase();
  const rows = document.querySelectorAll(".yoy-data-row");
  rows.forEach(r => {
    const text = r.innerText.toLowerCase();
    const note = r.dataset.note || "";
    if (!q || text.includes(q) || note.includes(q)) {
      r.classList.remove("hidden");
    } else {
      r.classList.add("hidden");
    }
  });
}
window.filterYoyTable = filterYoyTable;

// Generate & Load Realistic Historical Baseline Trades for Prior Year
async function loadSamplePriorYearTrades() {
  const mVal = parseInt($("yoyMonthSelect")?.value, 10) || 5;
  const compYear = parseInt($("yoyCompYearSelect")?.value, 10) || 2023;
  const season = getSolarSeasonInfo(mVal);

  const daysInMonth = new Date(compYear, mVal, 0).getDate();
  const generated = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${compYear}-${String(mVal).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const seed = (d * 19 + mVal * 31 + (compYear % 10) * 17) % 100;

    // Realistic seasonal weather simulation for prior year
    const isRain = (mVal === 7 || mVal === 8) ? (seed % 4 === 0) : (mVal === 5 && d === 11);
    const isCloudy = seed % 5 === 0;
    const isHeatwave = mVal === 5 && (d >= 4 && d <= 7);

    let peakMw = 10.4;
    if (isRain) peakMw = 3.2;
    else if (isCloudy) peakMw = 5.6;
    else if (isHeatwave) peakMw = 9.1; // thermal derating
    else peakMw = +(10.1 + (seed % 6) * 0.1).toFixed(2);

    const baseMcp = 3800 + (seed % 12) * 50;

    for (let b = 1; b <= 96; b++) {
      let mw = 0;
      if (b >= 25 && b <= 72) { // 06:00 to 18:00
        const progress = (b - 25) / (72 - 25);
        const bell = Math.sin(progress * Math.PI);
        if (isRain && b >= 44 && b <= 60) {
          mw = 0.5; // sudden afternoon monsoon shower
        } else {
          mw = bell * peakMw;
        }
        mw = +mw.toFixed(3);
      }

      generated.push({
        date: dStr,
        block: b,
        qty: -mw, // standard sell convention
        mcp: baseMcp + (b % 4) * 40,
        seg: "G-DAM",
        txn: "SELL"
      });
    }
  }

  pushUndoSnapshot(`Load Prior Year Baseline (${season.name} ${compYear})`);

  // Merge into state.trades (replace any existing trades for that date range)
  const existingOtherTrades = state.trades.filter(t => !t.date || !t.date.startsWith(`${compYear}-${String(mVal).padStart(2, "0")}`));
  state.trades = [...existingOtherTrades, ...generated];

  save();
  await saveStateToIndexedDB();
  updateUndoUI();

  showUndoToast(`Loaded ${daysInMonth} Days of ${compYear} Historical Baseline Trades (${generated.length} blocks)`, true);
  await renderYoyComparison();
}
window.loadSamplePriorYearTrades = loadSamplePriorYearTrades;

// Export Comprehensive Multi-Tab YoY Excel Report
function exportYoyReportExcel() {
  if (!yoyCurrentComparisonData) {
    alert("Please load or select a comparison period before exporting.");
    return;
  }

  const d = yoyCurrentComparisonData;
  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive KPI & Seasonal Variance Diagnostics
  const summaryAoa = [
    ["THDCIL 11 MW FLOATING SOLAR PV PLANT — KHURJA STPP"],
    [`YEAR-OVER-YEAR SOLAR GENERATION & SEASONAL VARIANCE COMPARISON REPORT`],
    [`Comparison: ${d.monthName} ${d.curYear} vs ${d.monthName} ${d.compYear} | Generated: ${new Date().toLocaleString('en-IN')}`],
    [],
    ["EXECUTIVE SEASONAL SYNTHESIS"],
    ["Solar Climate Regime:", d.seasonInfo.seasonName],
    ["Seasonal Characteristics:", d.seasonInfo.desc],
    ["Thermal Derating Risk:", d.seasonInfo.deratingRisk],
    [],
    ["METRIC SUMMARY", `${d.curYear} (Current)`, `${d.compYear} (Prior Year)`, "Variance (Delta)", "YoY Variance (%)"],
    ["Total Generation (MWh)", +d.curTotalMwh.toFixed(2), +d.compTotalMwh.toFixed(2), +(d.deltaMwh).toFixed(2), +d.pctMwh.toFixed(2)],
    ["Total Energy (MU)", +(d.curTotalMwh / 1000).toFixed(4), +(d.compTotalMwh / 1000).toFixed(4), +(d.deltaMwh / 1000).toFixed(4), +d.pctMwh.toFixed(2)],
    ["Capacity Utilization Factor (CUF %)", +d.curCuf.toFixed(2), +d.compCuf.toFixed(2), +d.deltaCuf.toFixed(2), "-"],
    ["Daily Average Generation (MWh/day)", +d.curDailyAvg.toFixed(2), +d.compDailyAvg.toFixed(2), +(d.curDailyAvg - d.compDailyAvg).toFixed(2), +((d.curDailyAvg - d.compDailyAvg) / (d.compDailyAvg || 1) * 100).toFixed(2)],
    ["Peak Scheduled Output (MW)", +d.curPeakMw.toFixed(2), +d.compPeakMw.toFixed(2), +(d.curPeakMw - d.compPeakMw).toFixed(2), "-"],
    ["Mean Solar Insolation (GHI kWh/m²/day)", +d.curAvgGhi.toFixed(2), +d.compAvgGhi.toFixed(2), +d.deltaGhi.toFixed(2), +d.pctGhi.toFixed(2)],
    ["Mean Cloud Cover (%)", +d.curAvgCloud, +d.compAvgCloud, +d.deltaCloud, "-"],
    ["Rainy Days (>=1mm)", d.curRainDays, d.compRainDays, d.curRainDays - d.compRainDays, "-"],
    ["Average Max Temperature (°C)", +d.curAvgTemp, +d.compAvgTemp, +d.deltaTemp, "-"],
    ["Gross Traded Revenue (₹)", +d.curTotalRev.toFixed(2), +d.compTotalRev.toFixed(2), +d.deltaRev.toFixed(2), +((d.deltaRev / (d.compTotalRev || 1)) * 100).toFixed(2)],
    ["Volume-Weighted MCP (₹/MWh)", +d.curMcpWeighted.toFixed(2), +d.compMcpWeighted.toFixed(2), +d.deltaMcp.toFixed(2), +((d.deltaMcp / (d.compMcpWeighted || 1)) * 100).toFixed(2)],
    ["Active Delivery Days", d.curActiveDays, d.compActiveDays, d.curActiveDays - d.compActiveDays, "-"]
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  XLSX.utils.book_append_sheet(wb, wsSummary, "YoY_Executive_Summary");

  // Sheet 2: Day-by-Day Reconciliation Breakdown
  const tableAoa = [
    ["Day", `${d.curYear} Date`, `${d.curYear} MWh`, `${d.curYear} Peak MW`, `${d.compYear} Date`, `${d.compYear} MWh`, `${d.compYear} Peak MW`, "Variance Delta (MWh)", "Variance %", "GHI (kWh/m²)", "Seasonal Note"]
  ];

  for (let day = 1; day <= d.totalDaysInMonth; day++) {
    const cur = d.curDailyMap.get(day);
    const comp = d.compDailyMap.get(day);
    const cw = d.curWeatherMap.get(day);

    const curMwh = cur ? +cur.mwh.toFixed(2) : 0;
    const compMwh = comp ? +comp.mwh.toFixed(2) : 0;
    const curPeak = cur ? +cur.maxMw.toFixed(2) : 0;
    const compPeak = comp ? +comp.maxMw.toFixed(2) : 0;
    const diff = +(curMwh - compMwh).toFixed(2);
    const pct = compMwh > 0 ? +((diff / compMwh) * 100).toFixed(1) : 0;

    tableAoa.push([
      day,
      cur ? cur.date : `${d.curYear}-${String(d.monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      curMwh,
      curPeak,
      comp ? comp.date : `${d.compYear}-${String(d.monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      compMwh,
      compPeak,
      diff,
      pct,
      cw ? +cw.solarInsolationKwh.toFixed(2) : "-",
      cw && cw.precipMm >= 5 ? `Rainfall (${cw.precipMm} mm)` : (cw && cw.cloudCover >= 65 ? `Cloudy (${cw.cloudCover}%)` : "Clear sky window")
    ]);
  }

  const wsTable = XLSX.utils.aoa_to_sheet(tableAoa);
  XLSX.utils.book_append_sheet(wb, wsTable, "Day_by_Day_Reconciliation");

  // Sheet 3: Diurnal 96-Block Average Profiles
  const blockAoa = [
    ["Block", "Time Period", `${d.curYear} Average Power (MW)`, `${d.compYear} Average Power (MW)`, "Diurnal Delta (MW)"]
  ];

  for (let b = 1; b <= 96; b++) {
    const startMin = (b - 1) * 15;
    const endMin = b * 15;
    const period = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")} - ${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    const curAvg = d.curBlockCounts[b] > 0 ? +(d.curBlockSums[b] / d.curBlockCounts[b]).toFixed(3) : 0;
    const compAvg = d.compBlockCounts[b] > 0 ? +(d.compBlockSums[b] / d.compBlockCounts[b]).toFixed(3) : 0;
    const delta = +(curAvg - compAvg).toFixed(3);

    blockAoa.push([b, period, curAvg, compAvg, delta]);
  }

  const wsBlock = XLSX.utils.aoa_to_sheet(blockAoa);
  XLSX.utils.book_append_sheet(wb, wsBlock, "Diurnal_96_Block_Curves");

  const filename = `THDC_11MW_Solar_YoY_${d.monthName}_${d.curYear}_vs_${d.compYear}.xlsx`;
  XLSX.writeFile(wb, filename);
}
window.exportYoyReportExcel = exportYoyReportExcel;

// Initialize automatic report dates on load
function initAutoReportDates() {
  const curDateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  document.querySelectorAll(".auto-report-date").forEach(el => {
    el.textContent = curDateStr;
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAutoReportDates);
} else {
  initAutoReportDates();
}
