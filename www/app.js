const DB_NAME = "pullupTrackerDB";
const DB_VERSION = 1;
const STORE_NAME = "entries";

let db = null;
let entries = [];
let editingId = null;

const els = {
    form: document.getElementById("entryForm"),
    entryDate: document.getElementById("entryDate"),
    pullups: document.getElementById("pullups"),
    weightKg: document.getElementById("weightKg"),
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
    weeklyChart: document.getElementById("weeklyChart")
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

function formatWeight(weight) {
    if (weight === null || weight === undefined || weight === "") {
        return "-";
    }
    return `${Number(weight).toFixed(1)} kg`;
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

        request.onsuccess = function (event) {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = function () {
            reject(request.error);
        };
    });
}

function getAllEntries() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = function () {
            resolve(request.result || []);
        };

        request.onerror = function () {
            reject(request.error);
        };
    });
}

function saveEntryToDb(entry) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = function () {
            resolve();
        };

        request.onerror = function () {
            reject(request.error);
        };
    });
}

function deleteEntryFromDb(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = function () {
            resolve();
        };

        request.onerror = function () {
            reject(request.error);
        };
    });
}

function getEntryByDate(date) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("date");
        const request = index.get(date);

        request.onsuccess = function () {
            resolve(request.result || null);
        };

        request.onerror = function () {
            reject(request.error);
        };
    });
}

async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persisted) {
        els.storageState.textContent = "Speicherstatus: lokal gespeichert";
        return;
    }

    const alreadyPersistent = await navigator.storage.persisted();

    if (alreadyPersistent) {
        els.storageState.textContent = "Speicherstatus: persistent";
        return;
    }

    if (navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        els.storageState.textContent = granted
            ? "Speicherstatus: persistent"
            : "Speicherstatus: lokal, aber nicht dauerhaft garantiert";
    } else {
        els.storageState.textContent = "Speicherstatus: lokal gespeichert";
    }
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
        const week = getISOWeek(entry.date);
        const pullups = toNumber(entry.pullups);
        const weight = entry.weightKg === null || entry.weightKg === "" ? null : Number(entry.weightKg);

        if (!grouped.has(week)) {
            grouped.set(week, {
                week,
                totalPullups: 0,
                days: 0,
                weightSum: 0,
                weightCount: 0
            });
        }

        const item = grouped.get(week);
        item.totalPullups += pullups;
        item.days += 1;

        if (weight !== null && !Number.isNaN(weight)) {
            item.weightSum += weight;
            item.weightCount += 1;
        }
    });

    return Array.from(grouped.values())
        .sort((a, b) => a.week.localeCompare(b.week))
        .map(item => ({
            week: item.week,
            avgPullups: item.days ? item.totalPullups / item.days : 0,
            avgWeight: item.weightCount ? item.weightSum / item.weightCount : null
        }));
}

function updateStats() {
    const totalEntries = entries.length;
    const totalPullups = entries.reduce((sum, entry) => sum + toNumber(entry.pullups), 0);
    const avgDay = totalEntries ? totalPullups / totalEntries : 0;

    const weekly = calculateWeeklyData(entries);
    const avgWeek = weekly.length
        ? weekly.reduce((sum, item) => sum + item.avgPullups, 0) / weekly.length
        : 0;

    els.statEntries.textContent = totalEntries;
    els.statTotalPullups.textContent = totalPullups.toFixed(0);
    els.statAvgDay.textContent = avgDay.toFixed(1);
    els.statAvgWeek.textContent = avgWeek.toFixed(1);
}

function renderTable() {
    if (!entries.length) {
        els.entriesTableBody.innerHTML = `
            <tr>
                <td colspan="4">Noch keine Daten vorhanden.</td>
            </tr>
        `;
        return;
    }

    els.entriesTableBody.innerHTML = entries.map(entry => `
        <tr>
            <td>${entry.date}</td>
            <td>${entry.pullups}</td>
            <td>${formatWeight(entry.weightKg)}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn small-btn" onclick="editEntry('${entry.id}')">Bearbeiten</button>
                    <button class="btn small-btn delete" onclick="removeEntry('${entry.id}')">Löschen</button>
                </div>
            </td>
        </tr>
    `).join("");
}

function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(300, Math.floor(rect.width * dpr));
    canvas.height = Math.max(220, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return {
        ctx,
        width: rect.width,
        height: rect.height
    };
}

function drawEmptyChart(canvas, title) {
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(title, width / 2, 26);
    ctx.fillText("Noch keine Daten vorhanden", width / 2, height / 2);
}

function drawMixedChart(canvas, labels, barData, lineData, config) {
    if (!labels.length) {
        drawEmptyChart(canvas, config.title);
        return;
    }

    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 36, right: 54, bottom: 54, left: 54 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(config.title, width / 2, 22);

    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    ctx.strokeStyle = "#64748b";
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    const maxBar = Math.max(...barData, 1);
    const filteredLine = lineData.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const maxLine = Math.max(...filteredLine, 1);

    const stepX = labels.length > 1 ? chartWidth / labels.length : chartWidth;
    const barWidth = Math.min(40, stepX * 0.5);

    ctx.font = "12px Arial";

    labels.forEach((label, index) => {
        const xCenter = padding.left + stepX * index + stepX / 2;
        const barValue = Number(barData[index]) || 0;
        const barHeight = (barValue / maxBar) * chartHeight;
        const barX = xCenter - barWidth / 2;
        const barY = height - padding.bottom - barHeight;

        ctx.fillStyle = config.barColor;
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle = "#cbd5e1";
        ctx.textAlign = "center";
        const shortLabel = label.length > 10 ? label.slice(5) : label;
        ctx.fillText(shortLabel, xCenter, height - padding.bottom + 18);
    });

    ctx.strokeStyle = config.lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;

    labels.forEach((label, index) => {
        const value = lineData[index];
        if (value === null || value === undefined || Number.isNaN(value)) {
            started = false;
            return;
        }

        const xCenter = padding.left + stepX * index + stepX / 2;
        const y = height - padding.bottom - ((value / maxLine) * chartHeight);

        if (!started) {
            ctx.moveTo(xCenter, y);
            started = true;
        } else {
            ctx.lineTo(xCenter, y);
        }
    });

    ctx.stroke();

    labels.forEach((label, index) => {
        const value = lineData[index];
        if (value === null || value === undefined || Number.isNaN(value)) {
            return;
        }

        const xCenter = padding.left + stepX * index + stepX / 2;
        const y = height - padding.bottom - ((value / maxLine) * chartHeight);

        ctx.fillStyle = config.lineColor;
        ctx.beginPath();
        ctx.arc(xCenter, y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "left";
    ctx.fillText(config.leftLabel, 8, padding.top + 6);

    ctx.textAlign = "right";
    ctx.fillText(config.rightLabel, width - 8, padding.top + 6);

    ctx.fillStyle = config.barColor;
    ctx.fillRect(padding.left, height - 18, 14, 10);
    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "left";
    ctx.fillText(config.barLegend, padding.left + 20, height - 9);

    ctx.strokeStyle = config.lineColor;
    ctx.beginPath();
    ctx.moveTo(padding.left + 150, height - 13);
    ctx.lineTo(padding.left + 170, height - 13);
    ctx.stroke();

    ctx.fillStyle = config.lineColor;
    ctx.beginPath();
    ctx.arc(padding.left + 160, height - 13, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(config.lineLegend, padding.left + 178, height - 9);

    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(String(maxBar), padding.left - 8, padding.top + 4);
    ctx.fillText("0", padding.left - 8, height - padding.bottom + 4);

    ctx.textAlign = "left";
    ctx.fillText(String(maxLine), width - padding.right + 8, padding.top + 4);
    ctx.fillText("0", width - padding.right + 8, height - padding.bottom + 4);
}

function renderCharts() {
    const dailyLabels = entries.map(entry => entry.date);
    const dailyPullups = entries.map(entry => toNumber(entry.pullups));
    const dailyWeights = entries.map(entry => entry.weightKg === null || entry.weightKg === "" ? null : Number(entry.weightKg));

    drawMixedChart(els.dailyChart, dailyLabels, dailyPullups, dailyWeights, {
        title: "Tägliche Klimmzüge und Gewicht",
        barColor: "rgba(34, 197, 94, 0.75)",
        lineColor: "rgba(96, 165, 250, 1)",
        leftLabel: "Klimmzüge",
        rightLabel: "Gewicht",
        barLegend: "Klimmzüge",
        lineLegend: "Gewicht"
    });

    const weekly = calculateWeeklyData(entries);
    const weeklyLabels = weekly.map(item => item.week);
    const weeklyPullups = weekly.map(item => Number(item.avgPullups.toFixed(2)));
    const weeklyWeights = weekly.map(item => item.avgWeight === null ? null : Number(item.avgWeight.toFixed(2)));

    drawMixedChart(els.weeklyChart, weeklyLabels, weeklyPullups, weeklyWeights, {
        title: "Wochendurchschnitt",
        barColor: "rgba(250, 204, 21, 0.75)",
        lineColor: "rgba(244, 114, 182, 1)",
        leftLabel: "Ø Klimmzüge",
        rightLabel: "Ø Gewicht",
        barLegend: "Ø Klimmzüge",
        lineLegend: "Ø Gewicht"
    });
}

function renderAll() {
    entries.sort((a, b) => a.date.localeCompare(b.date));
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
    setStatus("Bereit.");
}

async function reloadEntries() {
    entries = await getAllEntries();
    renderAll();
}

async function handleFormSubmit(event) {
    event.preventDefault();

    try {
        const date = els.entryDate.value;
        const pullups = toNumber(els.pullups.value);
        const weightKg = els.weightKg.value === "" ? null : Number(els.weightKg.value);

        if (!date) {
            throw new Error("Bitte ein Datum auswählen.");
        }

        const existing = await getEntryByDate(date);

        let entryId = editingId;
        if (existing && !editingId) {
            entryId = existing.id;
        }

        const entry = {
            id: entryId || crypto.randomUUID(),
            date,
            pullups,
            weightKg,
            updatedAt: new Date().toISOString()
        };

        await saveEntryToDb(entry);
        await reloadEntries();
        resetForm();
        setStatus("Eintrag gespeichert.");
    } catch (error) {
        setStatus(error.message || "Fehler beim Speichern.", true);
    }
}

window.editEntry = function (id) {
    const entry = entries.find(item => item.id === id);
    if (!entry) {
        return;
    }

    editingId = entry.id;
    els.entryDate.value = entry.date;
    els.pullups.value = entry.pullups;
    els.weightKg.value = entry.weightKg ?? "";
    setStatus(`Bearbeite Eintrag vom ${entry.date}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
};

window.removeEntry = async function (id) {
    const confirmed = confirm("Diesen Eintrag wirklich löschen?");
    if (!confirmed) {
        return;
    }

    try {
        await deleteEntryFromDb(id);
        if (editingId === id) {
            editingId = null;
        }
        await reloadEntries();
        setStatus("Eintrag gelöscht.");
    } catch (error) {
        setStatus(error.message || "Fehler beim Löschen.", true);
    }
};

function downloadJson(filename, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function exportBackup() {
    try {
        const backup = {
            app: "KlimmzuegeTracker",
            version: 1,
            exportedAt: new Date().toISOString(),
            entries
        };

        const json = JSON.stringify(backup, null, 2);
        const date = getTodayString();
        downloadJson(`klimmzuege-backup-${date}.json`, json);
        setStatus("Backup exportiert.");
    } catch (error) {
        setStatus("Backup konnte nicht exportiert werden.", true);
    }
}

async function importBackupFile(file) {
    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const backup = JSON.parse(text);

        if (!backup || !Array.isArray(backup.entries)) {
            throw new Error("Ungültige Sicherungsdatei.");
        }

        for (const item of backup.entries) {
            const normalized = {
                id: item.id || crypto.randomUUID(),
                date: item.date,
                pullups: toNumber(item.pullups),
                weightKg: item.weightKg === null || item.weightKg === "" ? null : Number(item.weightKg),
                updatedAt: item.updatedAt || new Date().toISOString()
            };

            if (!normalized.date) {
                continue;
            }

            await saveEntryToDb(normalized);
        }

        await reloadEntries();
        resetForm();
        setStatus("Backup importiert.");
    } catch (error) {
        setStatus(error.message || "Backup konnte nicht importiert werden.", true);
    } finally {
        els.importFile.value = "";
    }
}

window.addEventListener("resize", () => {
    renderCharts();
});

async function init() {
    try {
        await openDatabase();
        await requestPersistentStorage();
        await reloadEntries();
        resetForm();
    } catch (error) {
        setStatus("Initialisierung fehlgeschlagen.", true);
    }
}

els.form.addEventListener("submit", handleFormSubmit);
els.resetBtn.addEventListener("click", resetForm);
els.exportBtn.addEventListener("click", exportBackup);
els.importFile.addEventListener("change", event => {
    const file = event.target.files[0];
    importBackupFile(file);
});

init();
