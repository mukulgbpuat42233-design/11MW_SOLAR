import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// In-memory cache for weather requests
const weatherCache = new Map();

// Helper to map WMO weather code to description and icon
function getWmoDetails(code) {
  if (code === 0) return { desc: 'Clear Sky', icon: 'fa-sun text-amber-500', isDropRisk: false };
  if (code === 1) return { desc: 'Mainly Clear', icon: 'fa-cloud-sun text-amber-400', isDropRisk: false };
  if (code === 2) return { desc: 'Partly Cloudy', icon: 'fa-cloud-sun text-sky-500', isDropRisk: false };
  if (code === 3) return { desc: 'Overcast', icon: 'fa-cloud text-slate-400', isDropRisk: true };
  if (code === 45 || code === 48) return { desc: 'Foggy / Haze', icon: 'fa-smog text-slate-400', isDropRisk: true };
  if (code >= 51 && code <= 55) return { desc: 'Drizzle', icon: 'fa-cloud-rain text-blue-400', isDropRisk: true };
  if (code >= 61 && code <= 65) return { desc: 'Rain', icon: 'fa-cloud-showers-heavy text-blue-600', isDropRisk: true };
  if (code >= 80 && code <= 82) return { desc: 'Rain Showers', icon: 'fa-cloud-showers-water text-blue-500', isDropRisk: true };
  if (code >= 95) return { desc: 'Thunderstorm', icon: 'fa-cloud-bolt text-indigo-600', isDropRisk: true };
  return { desc: 'Scattered Clouds', icon: 'fa-cloud-sun text-slate-400', isDropRisk: false };
}

// Fallback generator for Khurja solar climate if external API is unreachable or dates are outside archive
function generateFallbackWeather(dateStr, lat, lon) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const month = d.getUTCMonth(); // 0 to 11
  // Solar irradiation variation in Northern India (Khurja, UP)
  // High: Apr-May-Jun (~6.0 - 6.8 kWh/m2)
  // Monsoon: Jul-Aug (~4.2 - 5.0 kWh/m2, frequent rain/cloud)
  // Post-monsoon: Sep-Oct (~5.2 - 5.8 kWh/m2)
  // Winter: Nov-Jan (~3.8 - 4.5 kWh/m2, morning fog)
  // Spring: Feb-Mar (~5.5 - 6.2 kWh/m2)
  const monthlyBaseInsolation = [4.2, 5.3, 6.0, 6.7, 6.8, 6.1, 4.6, 4.5, 5.3, 5.7, 4.8, 4.0];
  const monthlyCloudCover = [35, 25, 20, 15, 18, 45, 75, 78, 45, 15, 20, 40];
  const monthlyMaxTemp = [20, 24, 31, 37, 41, 40, 35, 34, 33, 32, 27, 21];

  const basePsh = monthlyBaseInsolation[month] || 5.2;
  const baseCloud = monthlyCloudCover[month] || 25;
  const baseTemp = monthlyMaxTemp[month] || 32;

  // Deterministic pseudo-random variation using date digits
  const seed = (d.getDate() * 13 + (month + 1) * 37) % 100;
  const varFactor = 0.85 + (seed / 100) * 0.3; // 0.85 to 1.15
  const isRainDay = (month === 6 || month === 7) && (seed % 4 === 0);
  const isCloudyDay = seed % 5 === 0;

  let cloudCover = Math.min(95, Math.max(5, Math.round(baseCloud * (isCloudyDay ? 1.6 : 1.0))));
  let precip = isRainDay ? +(15 + (seed % 35)).toFixed(1) : 0;
  let psh = +(basePsh * (isRainDay ? 0.45 : isCloudyDay ? 0.75 : varFactor)).toFixed(2);
  let shortwaveMj = +(psh * 3.6).toFixed(2);
  let tempMax = +(baseTemp + (seed % 7 - 3)).toFixed(1);
  let code = isRainDay ? 63 : (cloudCover > 60 ? 3 : (cloudCover > 30 ? 2 : 0));
  const wmo = getWmoDetails(code);

  return {
    date: dateStr,
    weatherCode: code,
    weatherDesc: wmo.desc,
    weatherIcon: wmo.icon,
    shortwaveRadiationMj: shortwaveMj,
    solarInsolationKwh: psh, // Peak sun hours
    sunshineHours: +(psh * 1.7).toFixed(1),
    cloudCover: cloudCover,
    precipMm: precip,
    tempMax: tempMax,
    tempMin: +(tempMax - 11).toFixed(1),
    tempMean: +(tempMax - 5.5).toFixed(1)
  };
}

// GET /api/weather
app.get('/api/weather', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 28.239;
    const lon = parseFloat(req.query.lon) || 77.873;
    const startDate = req.query.startDate || new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const endDate = req.query.endDate || new Date().toISOString().slice(0, 10);

    const cacheKey = `${lat.toFixed(3)}_${lon.toFixed(3)}_${startDate}_${endDate}`;
    if (weatherCache.has(cacheKey)) {
      return res.json({ success: true, fromCache: true, ...weatherCache.get(cacheKey) });
    }

    let dailyData = [];
    let dataSource = 'open-meteo';

    // 1. Try Open-Meteo Archive API first
    try {
      const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=weathercode,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,cloudcover_mean,sunshine_duration,shortwave_radiation_sum&timezone=Asia%2FKolkata`;
      const archiveResp = await fetch(archiveUrl, { headers: { 'User-Agent': 'THDCIL-Solar-Portal/1.0' } });

      if (archiveResp.ok) {
        const json = await archiveResp.json();
        if (json && json.daily && Array.isArray(json.daily.time) && json.daily.time.length > 0) {
          const d = json.daily;
          for (let i = 0; i < d.time.length; i++) {
            const date = d.time[i];
            const code = d.weathercode ? d.weathercode[i] : 0;
            const wmo = getWmoDetails(code);
            const mj = d.shortwave_radiation_sum ? d.shortwave_radiation_sum[i] : 0;
            const insolation = mj ? +(mj / 3.6).toFixed(2) : 0;
            const sunshineSec = d.sunshine_duration ? d.sunshine_duration[i] : 0;
            dailyData.push({
              date,
              weatherCode: code,
              weatherDesc: wmo.desc,
              weatherIcon: wmo.icon,
              shortwaveRadiationMj: +(mj || 0).toFixed(2),
              solarInsolationKwh: insolation, // Peak Sun Hours
              sunshineHours: sunshineSec ? +(sunshineSec / 3600).toFixed(1) : +(insolation * 1.6).toFixed(1),
              cloudCover: d.cloudcover_mean ? Math.round(d.cloudcover_mean[i]) : 0,
              precipMm: d.precipitation_sum ? +(d.precipitation_sum[i] || 0).toFixed(1) : 0,
              tempMax: d.temperature_2m_max ? +(d.temperature_2m_max[i] || 0).toFixed(1) : 0,
              tempMin: d.temperature_2m_min ? +(d.temperature_2m_min[i] || 0).toFixed(1) : 0,
              tempMean: d.temperature_2m_mean ? +(d.temperature_2m_mean[i] || 0).toFixed(1) : 0
            });
          }
        }
      }
    } catch (err) {
      console.warn('Open-Meteo Archive API call failed:', err.message);
    }

    // 2. If archive didn't return data (e.g. recent dates within last 90 days), try Forecast API
    if (dailyData.length === 0) {
      try {
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=90&forecast_days=1&daily=weathercode,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,cloudcover_mean,sunshine_duration,shortwave_radiation_sum&timezone=Asia%2FKolkata`;
        const fcResp = await fetch(forecastUrl, { headers: { 'User-Agent': 'THDCIL-Solar-Portal/1.0' } });
        if (fcResp.ok) {
          const json = await fcResp.json();
          if (json && json.daily && Array.isArray(json.daily.time)) {
            const d = json.daily;
            for (let i = 0; i < d.time.length; i++) {
              const date = d.time[i];
              if (date >= startDate && date <= endDate) {
                const code = d.weathercode ? d.weathercode[i] : 0;
                const wmo = getWmoDetails(code);
                const mj = d.shortwave_radiation_sum ? d.shortwave_radiation_sum[i] : 0;
                const insolation = mj ? +(mj / 3.6).toFixed(2) : 0;
                const sunshineSec = d.sunshine_duration ? d.sunshine_duration[i] : 0;
                dailyData.push({
                  date,
                  weatherCode: code,
                  weatherDesc: wmo.desc,
                  weatherIcon: wmo.icon,
                  shortwaveRadiationMj: +(mj || 0).toFixed(2),
                  solarInsolationKwh: insolation,
                  sunshineHours: sunshineSec ? +(sunshineSec / 3600).toFixed(1) : +(insolation * 1.6).toFixed(1),
                  cloudCover: d.cloudcover_mean ? Math.round(d.cloudcover_mean[i]) : 0,
                  precipMm: d.precipitation_sum ? +(d.precipitation_sum[i] || 0).toFixed(1) : 0,
                  tempMax: d.temperature_2m_max ? +(d.temperature_2m_max[i] || 0).toFixed(1) : 0,
                  tempMin: d.temperature_2m_min ? +(d.temperature_2m_min[i] || 0).toFixed(1) : 0,
                  tempMean: d.temperature_2m_mean ? +(d.temperature_2m_mean[i] || 0).toFixed(1) : 0
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('Open-Meteo Forecast API call failed:', err.message);
      }
    }

    // 3. Resilient fallback if both failed (e.g. network partition or sandbox restriction)
    if (dailyData.length === 0) {
      dataSource = 'khurja-climate-model';
      const cur = new Date(startDate + 'T00:00:00Z');
      const stop = new Date(endDate + 'T00:00:00Z');
      while (cur <= stop) {
        const dStr = cur.toISOString().slice(0, 10);
        dailyData.push(generateFallbackWeather(dStr, lat, lon));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    const payload = {
      plant: {
        name: 'THDCIL 11 MW Floating Solar PV Plant',
        location: 'Raw Water Reservoir, Khurja STPP, Bulandshahr, Uttar Pradesh',
        capacityMw: 11.0,
        latitude: lat,
        longitude: lon,
        elevationMeters: 199,
        performanceRatioBenchmark: 0.80
      },
      dateRange: { startDate, endDate },
      dataSource,
      count: dailyData.length,
      daily: dailyData
    };

    // Cache payload (limit cache size to 100 entries)
    if (weatherCache.size > 100) weatherCache.clear();
    weatherCache.set(cacheKey, payload);

    return res.json({ success: true, fromCache: false, ...payload });
  } catch (err) {
    console.error('Weather endpoint error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

// AI ASSISTANT CHAT ENDPOINT
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    
    // Construct standard history format
    const contents = [];
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.text }] });
      });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const systemInstruction = "You are an expert Commercial Power Trading AI Assistant for the THDCIL 11 MW Floating Solar PV Plant at Khurja STPP. Your name is 'Gemini Trading Assistant'. You help analyze market clearing prices (MCP), generation blocks, weather correlations, and IEX trading regulations. Provide professional, concise, and accurate responses. You have access to Google Search to look up the latest IEX circulars, CERC regulations, and UP SLDC updates.";

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      tools: [{ googleSearch: {} }],
      config: {
        systemInstruction: systemInstruction,
      },
    });

    res.json({ success: true, text: response.text });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
export default app;
