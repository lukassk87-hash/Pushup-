const DB_NAME = "pullupTrackerDB";
const DB_VERSION = 2;
const STORE_NAME = "entries";

let db = null;
let allEntries = [];
let filteredEntries = [];
let editingId = null;
let resizeTimer = null;

let filterFrom = "";
let filterTo = "";

const els = {
    form: document.getElementById("entryForm"),
    entryDate: document.getElementById("entryDate"),
    pullups: document.getElementById("pullups"),
    weightKg: document.getElementById("weightKg"),
    bodyFat: document.getElementById("bodyFat"),
    resetBtn: document.getElementById("resetBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importFile: document.getElementById("importFile"),
    status: document.getElementById("status"),
    storageState: document.getElementById("storageState"),
    entriesTableBody: document.getElementById("entriesTableBody"),
    statEntries: document.getElementById("statEntries"),
    statTotalPullups: document.getElementById("statTotalPullups"),
    statAvgDay: document.getElementById("statAvgDay"),
    statAvgWeek: document.getElementById("statAvgWeek"),
    dailyChart: document.getElementById("dailyChart"),
    weeklyChart: document.getElementById("weeklyChart"),
    filterFrom: document.getElementById("filterFrom"),
    filterTo: document.getElementById("filterTo"),
    applyFilterBtn: document.getElementById("applyFilterBtn"),
    resetFilterBtn: document.getElementById("resetFilterBtn")
};

function setStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.style.color = isError ? "#fca5a5" : "#94a3b8";
}

function getTodayString() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatWeight(weight) {
    if (weight === null || weight === undefined) return "-";
    const n = Number(weight);
    return Number.isFinite(n) ? `${n.toFixed(1)} kg` : "-";
}

function formatBodyFat(bf) {
    if (bf === null || bf === undefined) return "-";
    const n = Number(bf);
    return Number.isFinite(n) ? `${n.toFixed(1)} %` : "-";
}

function sanitizeEntry(raw, preferredId = null) {
    if (!raw || typeof raw !== "object") return null;
    const date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (!date) return null;
    if (raw.pullups === undefined || raw.pullups === null || raw.pullups === "") return null;
    const parsedPullups = Number(raw.pullups);
    if (!Number.isFinite(parsedPullups) || parsedPullups < 0) return null;

    let weightKg = null;
    if (raw.weightKg !== undefined && raw.weightKg !== null && raw.weightKg !== "") {
        const parsedWeight = Number(raw.weightKg);
        if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return null;
        weightKg = parsedWeight;
    }

    let bodyFat = null;
    if (raw.bodyFat !== undefined && raw.bodyFat !== null && raw.bodyFat !== "") {
        const parsedFat = Number(raw.bodyFat);
        if (!Number.isFinite(parsedFat) || parsedFat < 0 || parsedFat > 100) return null;
        bodyFat = parsedFat;
    }

    return {
        id: preferredId || raw.id || crypto.randomUUID(),
        date,
        pullups: Math.round(parsedPullups),
        weightKg,
        bodyFat,
        updatedAt: raw.updatedAt || new Date().toISOString()
    };
}

function buildStoredEntry(raw, existing = null, mode = "replace") {
    const normalized = sanitizeEntry(raw, existing?.id || null);
    if (!normalized) return null;

    const existingPullups = existing ? Math.max(0, Math.round(toNumber(existing.pullups))) : 0;
    const newPullups = Math.max(0, Math.round(toNumber(normalized.pullups)));

    const keepExistingWeight = mode === "accumulate" && existing && (normalized.weightKg === null || normalized.weightKg === undefined);
    const keepExistingFat = mode === "accumulate" && existing && (normalized.bodyFat === null || normalized.bodyFat === undefined);

    return {
        id: existing?.id || normalized.id,
        date: normalized.date,
        pullups: mode === "accumulate" ? existingPullups + newPullups : newPullups,
        weightKg: keepExistingWeight ? toNullableNumber(existing.weightKg) : normalized.weightKg,
        bodyFat: keepExistingFat ? toNullableNumber(existing.bodyFat) : normalized.bodyFat,
        updatedAt: new Date().toISOString()
    };
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function (event) {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("date", "date", { unique: true });
            }
        };
        request.onsuccess = (event) => { db = event.target.result; resolve(db); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Datenbank blockiert, andere Tabs schließen."));
    });
}

function getAllEntries() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function saveEntryToDb(entry) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function deleteEntryFromDb(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function getEntryByDate(date) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("date");
        const request = index.get(date);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function requestPersistentStorage() {
    try {
        if (!navigator.storage?.persisted) {
            els.storageState.textContent = "Speicherstatus: lokal";
            return;
        }
        const already = await navigator.storage.persisted();
        if (already) { els.storageState.textContent = "Speicherstatus: persistent"; return; }
        if (navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            els.storageState.textContent = granted ? "Speicherstatus: persistent" : "Speicherstatus: lokal (nicht dauerhaft)";
        } else {
            els.storageState.textContent = "Speicherstatus: lokal";
        }
    } catch { els.storageState.textContent = "Speicherstatus: lokal"; }
}

function applyFilter() {
    let filtered = [...allEntries];
    if (filterFrom) filtered = filtered.filter(e => e.date >= filterFrom);
    if (filterTo) filtered = filtered.filter(e => e.date <= filterTo);
    filtered.sort((a,b) => a.date.localeCompare(b.date));
    filteredEntries = filtered;
    renderAll();
}

function setFilterFromUI() {
    filterFrom = els.filterFrom.value;
    filterTo = els.filterTo.value;
    applyFilter();
}

function resetFilter() {
    els.filterFrom.value = "";
    els.filterTo.value = "";
    filterFrom = "";
    filterTo = "";
    applyFilter();
}

function getISOWeek(dateString) {
    const date = new Date(dateString + "T00:00:00");
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstDayNr = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
    const weekNo = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000));
    return `${target.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function calculateWeeklyData(data) {
    const grouped = new Map();
    data.forEach(entry => {
        if (!entry?.date) return;
        const week = getISOWeek(entry.date);
        const pullups = Math.max(0, Math.round(toNumber(entry.pullups)));
        const weight = toNullableNumber(entry.weightKg);
        if (!grouped.has(week)) {
            grouped.set(week, { week, totalPullups: 0, days: 0, weightSum: 0, weightCount: 0 });
        }
        const item = grouped.get(week);
        item.totalPullups += pullups;
        item.days += 1;
        if (weight !== null) { item.weightSum += weight; item.weightCount++; }
    });
    return Array.from(grouped.values()).sort((a,b) => a.week.localeCompare(b.week)).map(item => ({
        week: item.week,
        avgPullups: item.days ? item.totalPullups / item.days : 0,
        avgWeight: item.weightCount ? item.weightSum / item.weightCount : null
    }));
}

function updateStats() {
    const totalEntries = filteredEntries.length;
    const totalPullups = filteredEntries.reduce((sum, e) => sum + Math.max(0, Math.round(toNumber(e.pullups))), 0);
    const avgDay = totalEntries ? totalPullups / totalEntries : 0;
    const weekly = calculateWeeklyData(filteredEntries);
    const avgWeek = weekly.length ? weekly.reduce((sum, w) => sum + w.avgPullups, 0) / weekly.length : 0;
    els.statEntries.textContent = totalEntries;
    els.statTotalPullups.textContent = totalPullups.toFixed(0);
    els.statAvgDay.textContent = avgDay.toFixed(1);
    els.statAvgWeek.textContent = avgWeek.toFixed(1);
}

function renderTable() {
    if (!filteredEntries.length) {
        els.entriesTableBody.innerHTML = `<tr><td colspan="5">Keine Daten im gewählten Zeitraum.</td></tr>`;
        return;
    }
    els.entriesTableBody.innerHTML = filteredEntries.map(entry => `
        <tr>
            <td>${entry.date}</td>
            <td>${Math.max(0, Math.round(toNumber(entry.pullups)))}</td>
            <td>${formatWeight(entry.weightKg)}</td>
            <td>${formatBodyFat(entry.bodyFat)}</td>
            <td><div class="action-buttons">
                <button class="btn small-btn" onclick="editEntry('${entry.id}')">Bearbeiten</button>
                <button class="btn small-btn delete" onclick="removeEntry('${entry.id}')">Löschen</button>
            </div></td>
        </tr>
    `).join("");
}

function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width || 300));
    const height = Math.max(220, Math.floor(rect.height || 220));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr,dpr);
    return { ctx, width, height };
}

function drawMixedChartFine(canvas, labels, barData, lineData, config, useShortDate = true) {
    if (!labels.length) {
        const { ctx, width, height } = prepareCanvas(canvas);
        ctx.clearRect(0,0,width,height);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText(config.title, width/2, 26);
        ctx.fillText("Keine Daten", width/2, height/2);
        return;
    }

    let displayLabels = labels;
    if (useShortDate && labels.length > 0 && labels[0].includes("-")) {
        displayLabels = labels.map(label => {
            const parts = label.split("-");
            if (parts.length === 3) return `${parts[2]}-${parts[1]}`;
            return label;
        });
    }

    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0,0,width,height);
    const padding = { top: 40, right: 56, bottom: 80, left: 56 };
    const chartWidth = Math.max(40, width - padding.left - padding.right);
    const chartHeight = Math.max(40, height - padding.top - padding.bottom);

    const maxBar = Math.max(1, ...barData.map(v => Math.max(0, Number(v) || 0)));

    const validLine = lineData.filter(v => v !== null && Number.isFinite(v));
    let minLine, maxLine;
    if (validLine.length === 0) {
        minLine = 0; maxLine = 1;
    } else if (validLine.length === 1) {
        const val = validLine[0];
        minLine = Math.max(0, val - 2);
        maxLine = val + 2;
    } else {
        minLine = Math.min(...validLine);
        maxLine = Math.max(...validLine);
    }
    let range = maxLine - minLine;
    if (range < 0.5) range = 0.5;
    const lowerBound = minLine - range * 0.1;
    const upperBound = maxLine + range * 0.1;
    const finalMinLine = Math.max(0, lowerBound);
    const finalMaxLine = Math.max(upperBound, finalMinLine + 0.1);

    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;
    for (let i=0; i<=4; i++) {
        const y = padding.top + (chartHeight/4)*i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width-padding.right, y); ctx.stroke();
    }
    ctx.strokeStyle = "#64748b";
    ctx.beginPath(); ctx.moveTo(padding.left, padding.top); ctx.lineTo(padding.left, height-padding.bottom); ctx.lineTo(width-padding.right, height-padding.bottom); ctx.stroke();

    const stepX = chartWidth / labels.length;
    const barWidth = Math.min(40, Math.max(10, stepX * 0.55));
    ctx.font = "11px Arial";

    labels.forEach((_, idx) => {
        const xCenter = padding.left + stepX*idx + stepX/2;
        const barVal = Math.max(0, Number(barData[idx])||0);
        const barH = (barVal / maxBar) * chartHeight;
        const barX = xCenter - barWidth/2;
        const barY = height - padding.bottom - barH;
        ctx.fillStyle = config.barColor;
        ctx.fillRect(barX, barY, barWidth, barH);

        ctx.fillStyle = "#cbd5e1";
        const labelText = displayLabels[idx];
        ctx.save();
        ctx.translate(xCenter, height - padding.bottom + 8);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillText(labelText, 0, 0);
        ctx.restore();
    });

    if (validLine.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = config.lineColor;
        ctx.lineWidth = 2;
        let started = false;
        labels.forEach((_, idx) => {
            const val = lineData[idx];
            if (val === null || !Number.isFinite(val)) { started = false; return; }
            const x = padding.left + stepX*idx + stepX/2;
            const y = height - padding.bottom - ((val - finalMinLine) / (finalMaxLine - finalMinLine)) * chartHeight;
            if (!started) { ctx.moveTo(x,y); started = true; }
            else { ctx.lineTo(x,y); }
        });
        ctx.stroke();
        labels.forEach((_, idx) => {
            const val = lineData[idx];
            if (val === null || !Number.isFinite(val)) return;
            const x = padding.left + stepX*idx + stepX/2;
            const y = height - padding.bottom - ((val - finalMinLine) / (finalMaxLine - finalMinLine)) * chartHeight;
            ctx.fillStyle = config.lineColor;
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
        });
    }

    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "left";
    ctx.fillText(config.leftLabel, 8, padding.top+6);
    ctx.textAlign = "right";
    ctx.fillText(config.rightLabel, width-8, padding.top+6);
    ctx.fillStyle = config.barColor;
    ctx.fillRect(padding.left, height-18, 14,10);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(config.barLegend, padding.left+20, height-9);
    ctx.strokeStyle = config.lineColor;
    ctx.beginPath(); ctx.moveTo(padding.left+150, height-13); ctx.lineTo(padding.left+170, height-13); ctx.stroke();
    ctx.fillStyle = config.lineColor;
    ctx.beginPath(); ctx.arc(padding.left+160, height-13, 3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(config.lineLegend, padding.left+178, height-9);
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(String(maxBar), padding.left-8, padding.top+4);
    ctx.fillText("0", padding.left-8, height-padding.bottom+4);
    ctx.textAlign = "left";
    ctx.fillText(finalMaxLine.toFixed(1), width-padding.right+8, padding.top+4);
    ctx.fillText(finalMinLine.toFixed(1), width-padding.right+8, height-padding.bottom+4);
}

function renderCharts() {
    const dailyLabels = filteredEntries.map(e => e.date);
    const dailyPullups = filteredEntries.map(e => Math.max(0, Math.round(toNumber(e.pullups))));
    const dailyWeights = filteredEntries.map(e => toNullableNumber(e.weightKg));
    drawMixedChartFine(els.dailyChart, dailyLabels, dailyPullups, dailyWeights, {
        title: "Tägliche Klimmzüge & Gewicht (feine Skala)",
        barColor: "rgba(34,197,94,0.75)",
        lineColor: "rgba(96,165,250,1)",
        leftLabel: "Klimmzüge",
        rightLabel: "Gewicht (kg)",
        barLegend: "Klimmzüge",
        lineLegend: "Gewicht"
    }, true);

    const weekly = calculateWeeklyData(filteredEntries);
    const weeklyLabels = weekly.map(w => w.week);
    const weeklyPullups = weekly.map(w => w.avgPullups);
    const weeklyWeights = weekly.map(w => w.avgWeight);
    drawMixedChartFine(els.weeklyChart, weeklyLabels, weeklyPullups, weeklyWeights, {
        title: "Wochendurchschnitt (feine Gewichtsskala)",
        barColor: "rgba(250,204,21,0.75)",
        lineColor: "rgba(244,114,182,1)",
        leftLabel: "Ø Klimmzüge",
        rightLabel: "Ø Gewicht (kg)",
        barLegend: "Ø Klimmzüge",
        lineLegend: "Ø Gewicht"
    }, false);
}

function renderAll() {
    renderTable();
    updateStats();
    renderCharts();
}

function resetForm() {
    editingId = null;
    els.form.reset();
    els.entryDate.value = getTodayString();
    els.pullups.value = 0;
    els.weightKg.value = "";
    els.bodyFat.value = "";
    setStatus("Bereit.");
}

async function reloadEntries() {
    const raw = await getAllEntries();
    allEntries = raw.map(item => sanitizeEntry(item)).filter(Boolean);
    applyFilter();
}

async function handleFormSubmit(event) {
    event.preventDefault();
    try {
        if (!els.form.checkValidity()) { els.form.reportValidity(); return; }
        const date = els.entryDate.value.trim();
        const pullupsRaw = els.pullups.value;
        const weightRaw = els.weightKg.value;
        const fatRaw = els.bodyFat.value;
        if (!date) throw new Error("Datum auswählen.");
        const pullupsNum = Number(pullupsRaw);
        if (!Number.isFinite(pullupsNum) || pullupsNum < 0) throw new Error("Klimmzüge ≥0.");
        if (weightRaw !== "") { const w = Number(weightRaw); if (!Number.isFinite(w) || w < 0) throw new Error("Gewicht ≥0."); }
        if (fatRaw !== "") { const f = Number(fatRaw); if (!Number.isFinite(f) || f < 0 || f > 100) throw new Error("Körperfett 0-100."); }
        const existing = await getEntryByDate(date);
        const merged = buildStoredEntry({
            date, pullups: pullupsNum,
            weightKg: weightRaw === "" ? null : Number(weightRaw),
            bodyFat: fatRaw === "" ? null : Number(fatRaw),
            updatedAt: new Date().toISOString()
        }, existing, "accumulate");
        if (!merged) throw new Error("Ungültige Eingabe.");
        await saveEntryToDb(merged);
        await reloadEntries();
        resetForm();
        setStatus(existing ? "Eintrag aktualisiert (Klimmzüge addiert)." : "Eintrag gespeichert.");
    } catch (error) { setStatus(error.message, true); }
}

window.editEntry = function(id) {
    const entry = allEntries.find(e => e.id === id);
    if (!entry) return;
    editingId = entry.id;
    els.entryDate.value = entry.date;
    els.pullups.value = 0;
    els.weightKg.value = entry.weightKg ?? "";
    els.bodyFat.value = entry.bodyFat ?? "";
    setStatus(`Bearbeite ${entry.date}. Neue Klimmzüge werden addiert.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
};

window.removeEntry = async function(id) {
    if (!confirm("Eintrag löschen?")) return;
    try {
        await deleteEntryFromDb(id);
        if (editingId === id) editingId = null;
        await reloadEntries();
        resetForm();
        setStatus("Eintrag gelöscht.");
    } catch (error) { setStatus(error.message, true); }
};

async function exportBackup() {
    try {
        const exportEntries = allEntries.map(e => ({
            id: e.id, date: e.date, pullups: e.pullups, weightKg: e.weightKg, bodyFat: e.bodyFat, updatedAt: e.updatedAt
        }));
        const backup = { app: "KlimmzuegeTracker", version: 2, exportedAt: new Date().toISOString(), entries: exportEntries };
        const json = JSON.stringify(backup, null, 2);
        const defaultName = `klimmzuege-backup-${getTodayString()}.json`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultName,
                    types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
                setStatus(`Backup gespeichert: ${handle.name}`);
                return;
            } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
        }
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(`Backup exportiert (Download-Ordner): ${defaultName}`);
    } catch (error) { setStatus("Export fehlgeschlagen: " + error.message, true); }
}

async function importBackupFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        if (!text.trim()) throw new Error("Datei ist leer.");
        let backup;
        try { backup = JSON.parse(text); } catch { throw new Error("Kein gültiges JSON."); }
        if (!backup?.entries || !Array.isArray(backup.entries)) throw new Error("Ungültiges Backup-Format.");
        let imported = 0, updated = 0, skipped = 0;
        for (const item of backup.entries) {
            const date = item?.date?.trim();
            if (!date) { skipped++; continue; }
            const existing = await getEntryByDate(date);
            const normalized = buildStoredEntry({
                date, pullups: item.pullups, weightKg: item.weightKg, bodyFat: item.bodyFat, updatedAt: item.updatedAt
            }, existing, "replace");
            if (!normalized) { skipped++; continue; }
            await saveEntryToDb(normalized);
            existing ? updated++ : imported++;
        }
        await reloadEntries();
        resetFilter();
        setStatus(`Import fertig: ${imported} neu, ${updated} ersetzt, ${skipped} übersprungen.`);
    } catch (error) { setStatus(error.message, true); }
    finally { els.importFile.value = ""; }
}

window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderCharts(), 120);
});

async function init() {
    try {
        await openDatabase();
        await requestPersistentStorage();
        await reloadEntries();
        resetForm();
        els.applyFilterBtn.addEventListener("click", setFilterFromUI);
        els.resetFilterBtn.addEventListener("click", resetFilter);
    } catch (error) { setStatus(error.message || "Init fehlgeschlagen.", true); }
}

els.form.addEventListener("submit", handleFormSubmit);
els.resetBtn.addEventListener("click", resetForm);
els.exportBtn.addEventListener("click", exportBackup);
els.importFile.addEventListener("change", e => importBackupFile(e.target.files[0]));

init();