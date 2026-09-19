import { insertRows, loadProducts } from "../lib/aronium";
import { backupCurrent, connectedName, getDatabase, persistDatabase } from "../lib/db-file";
import { saveBatch } from "../lib/history";
import { matchRows } from "../lib/matcher";
import { extractMany, getLastOcrText } from "../lib/ocr";
import { canvasToFile, drawSampleReceipt, SAMPLE_PRODUCTS } from "../lib/sample";
import { loadSettings } from "../lib/settings";
import { displayStatus, isValidRow, type Product, type TxnRow } from "../types";
import { escapeHtml, statusClass } from "./dashboard";

interface BatchState {
  step: number;
  files: File[];
  previews: string[];
  rows: TxnRow[];
  busy: boolean;
  saleDone: boolean;
  selected: string | null;
}

const state: BatchState = {
  step: 1,
  files: [],
  previews: [],
  rows: [],
  busy: false,
  saleDone: false,
  selected: null,
};

export function resetBatch(): void {
  state.previews.forEach((url) => URL.revokeObjectURL(url));
  state.step = 1;
  state.files = [];
  state.previews = [];
  state.rows = [];
  state.busy = false;
  state.saleDone = false;
  state.selected = null;
}

export function renderBatch(root: HTMLElement, onFinished: () => void): void {
  root.innerHTML = `
    <div class="steps">
      <div class="pill" data-step="1">1  Setup</div>
      <div class="pill" data-step="2">2  Extract</div>
      <div class="pill" data-step="3">3  Match</div>
      <div class="pill" data-step="4">4  Sales</div>
    </div>
    <div class="toolbar">
      <button class="btn ghost" id="back">Back</button>
      <span class="muted grow" id="status"></span>
      <button class="btn" id="next">Extract</button>
    </div>
    <p class="muted" id="db-hint"></p>
    <div id="setup">
      <div class="drop" id="drop">
        <div>
          <strong>Drag images here · 1 or multiple</strong>
          <p class="muted">PNG / JPG screenshots of transaction history</p>
          <div class="toolbar" style="justify-content:center">
            <label class="btn">Add images<input id="files" class="hidden" type="file" accept="image/*" multiple></label>
            <button class="btn ghost" id="sample">Try sample</button>
            <button class="btn ghost" id="clear">Clear</button>
          </div>
          <p class="muted" id="count">0 images</p>
        </div>
      </div>
      <div class="thumbs" id="thumbs"></div>
    </div>
    <div id="table-page" class="hidden">
      <div class="toolbar">
        <button class="btn ghost" id="edit">Edit selected</button>
        <button class="btn ghost" id="skip">Skip / unskip</button>
        <button class="btn" id="rematch">Rematch random</button>
        <span class="muted grow" id="summary"></span>
      </div>
      <div class="table-wrap card" style="padding:0">
        <table>
          <thead>
            <tr><th>DateTime</th><th>Price</th><th>Product code</th><th>Name</th><th>Status</th></tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const status = root.querySelector<HTMLElement>("#status")!;
  const next = root.querySelector<HTMLButtonElement>("#next")!;
  const back = root.querySelector<HTMLButtonElement>("#back")!;
  const rematch = root.querySelector<HTMLButtonElement>("#rematch")!;

  const refreshHint = () => {
    root.querySelector("#db-hint")!.textContent = connectedName()
      ? `Using database from Settings · ${connectedName()}`
      : "No database in Settings. Open Settings and select pos.db once. You can still try the sample.";
  };

  const refreshThumbs = () => {
    root.querySelector("#count")!.textContent = `${state.files.length} image(s)`;
    root.querySelector("#thumbs")!.innerHTML = state.previews
      .slice(0, 8)
      .map((url) => `<img src="${url}" alt="">`)
      .join("");
  };

  const refreshTable = () => {
    const body = root.querySelector("#rows")!;
    body.innerHTML = state.rows
      .map((row) => {
        const statusText = displayStatus(row);
        return `<tr data-id="${row.rowId}" class="${state.selected === row.rowId ? "selected" : ""}">
          <td>${escapeHtml(row.datetime)}</td>
          <td>${row.amount.toFixed(2)}</td>
          <td>${escapeHtml(row.productCode)}</td>
          <td>${escapeHtml(row.productName)}</td>
          <td class="${statusClass(statusText)}">${escapeHtml(statusText)}</td>
        </tr>`;
      })
      .join("");
    const valid = state.rows.filter(isValidRow).length;
    let summary = `${state.rows.length} rows · ${valid} ready`;
    if (state.step === 4) {
      const inserted = state.rows.filter((row) => row.result === "inserted").length;
      const skipped = state.rows.filter((row) => row.result === "skipped").length;
      const failed = state.rows.filter((row) => row.result === "failed").length;
      const total = state.rows.filter((row) => row.result === "inserted").reduce((sum, row) => sum + row.amount, 0);
      summary = `Inserted ${inserted} · Skipped ${skipped} · Failed ${failed} · Amount ${total.toFixed(2)}`;
    }
    root.querySelector("#summary")!.textContent = summary;
    body.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        state.selected = tr.getAttribute("data-id");
        refreshTable();
      });
      tr.addEventListener("dblclick", () => editSelected());
    });
  };

  const showStep = (step: number) => {
    state.step = step;
    root.querySelectorAll(".pill").forEach((pill) => {
      pill.classList.toggle("on", Number(pill.getAttribute("data-step")) === step);
    });
    root.querySelector("#setup")!.classList.toggle("hidden", step !== 1);
    root.querySelector("#table-page")!.classList.toggle("hidden", step === 1);
    next.textContent = step === 1 ? "Extract" : step === 2 ? "Next  ·  Match" : step === 3 ? "Enter Sale" : "Go to Dashboard";
    back.disabled = state.busy || state.saleDone || step === 1;
    rematch.disabled = step !== 3 || state.saleDone;
    refreshTable();
  };

  const addFiles = (files: File[]) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (state.files.some((existing) => existing.name === file.name && existing.size === file.size)) continue;
      state.files.push(file);
      state.previews.push(URL.createObjectURL(file));
    }
    refreshThumbs();
  };

  const selectedRow = () => state.rows.find((row) => row.rowId === state.selected);

  const editSelected = () => {
    const row = selectedRow();
    if (!row || state.saleDone) return;
    const overlay = document.createElement("div");
    overlay.className = "dialog";
    overlay.innerHTML = `<div class="card">
      <h3>Edit row</h3>
      <label>DateTime (YYYY-MM-DD HH:MM:SS)</label>
      <input id="dt" value="${escapeHtml(row.datetime)}" />
      <label>Amount</label>
      <input id="amt" value="${row.amount.toFixed(2)}" />
      <div class="toolbar" style="margin-top:16px">
        <button class="btn" id="save-row">Save</button>
        <button class="btn ghost" id="cancel-row">Cancel</button>
      </div>
    </div>`;
    document.body.append(overlay);
    overlay.querySelector("#cancel-row")?.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#save-row")?.addEventListener("click", () => {
      const datetime = overlay.querySelector<HTMLInputElement>("#dt")!.value.trim();
      const amount = Number(overlay.querySelector<HTMLInputElement>("#amt")!.value);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(datetime) || !Number.isFinite(amount)) {
        alert("Check datetime and amount.");
        return;
      }
      row.datetime = datetime;
      row.amount = Math.round(amount * 100) / 100;
      row.status = "ok";
      row.error = "";
      overlay.remove();
      refreshTable();
    });
  };

  const products = (): Product[] => {
    const db = getDatabase();
    return db ? loadProducts(db) : SAMPLE_PRODUCTS;
  };

  const setBusy = (busy: boolean, text = "") => {
    state.busy = busy;
    next.disabled = busy;
    back.disabled = busy || state.saleDone || state.step === 1;
    status.textContent = text;
  };

  root.querySelector("#files")?.addEventListener("change", (event) => {
    addFiles([...(event.target as HTMLInputElement).files!]);
  });
  root.querySelector("#clear")?.addEventListener("click", () => {
    resetBatch();
    refreshThumbs();
    showStep(1);
  });
  root.querySelector("#sample")?.addEventListener("click", () => {
    addFiles([canvasToFile(drawSampleReceipt())]);
    status.textContent = "Sample receipt added — Extract to read the 10 demo sales.";
  });
  const drop = root.querySelector("#drop")!;
  drop.addEventListener("dragover", (event) => event.preventDefault());
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles([...(event as DragEvent).dataTransfer?.files ?? []]);
  });
  root.querySelector("#skip")?.addEventListener("click", () => {
    const row = selectedRow();
    if (!row || state.saleDone) return;
    row.skipped = !row.skipped;
    if (row.skipped) row.result = "";
    refreshTable();
  });
  root.querySelector("#edit")?.addEventListener("click", editSelected);
  rematch.addEventListener("click", () => {
    if (state.step !== 3 || state.saleDone) return;
    matchRows(state.rows, products());
    refreshTable();
    status.textContent = "Products rematched at random";
  });

  back.addEventListener("click", () => {
    if (state.busy || state.saleDone) return;
    if (state.step === 3) {
      for (const row of state.rows) {
        row.productId = null;
        row.productCode = "";
        row.productName = "";
        row.catalogPrice = null;
        row.matchType = "";
      }
      showStep(2);
    } else if (state.step === 2) showStep(1);
  });

  next.addEventListener("click", async () => {
    if (state.busy) return;
    if (state.step === 1) {
      if (!state.files.length) {
        alert("Add at least one screenshot.");
        return;
      }
      setBusy(true, "Extracting datetime and amount…");
      try {
        state.rows = await extractMany(state.files, loadSettings().year);
        if (!state.rows.length) {
          const extra = getLastOcrText().trim();
          alert(extra ? `Could not find datetime + amount.\n\nOCR text:\n${extra.slice(0, 400)}` : "Could not find datetime + amount in the image.");
          return;
        }
        showStep(2);
        status.textContent = `Extracted ${state.rows.length} transaction(s)`;
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false, status.textContent);
      }
      return;
    }
    if (state.step === 2) {
      if (!state.rows.some(isValidRow)) {
        alert("Need at least one valid row.");
        return;
      }
      matchRows(state.rows, products());
      showStep(3);
      status.textContent = `Matched ${state.rows.filter((row) => row.productId).length} product(s)${getDatabase() ? "" : " · sample catalog"}`;
      return;
    }
    if (state.step === 3) {
      if (state.rows.some((row) => isValidRow(row) && !row.productId)) {
        alert("Some rows have no product. Rematch or skip them.");
        return;
      }
      const db = getDatabase();
      if (!db) {
        alert("Choose pos.db in Settings before writing sales. Extract and match can use the sample catalog.");
        return;
      }
      if (!confirm("Write these sales into pos.db? A backup download starts first. Close Aronium first.")) return;
      setBusy(true, "Writing sales…");
      try {
        const backupName = backupCurrent();
        insertRows(db, state.rows);
        const wrote = await persistDatabase();
        saveBatch(connectedName() || "pos.db", state.files.length, state.rows);
        state.saleDone = true;
        showStep(4);
        status.textContent = wrote
          ? `Done. Backup downloaded as ${backupName}`
          : `Done. Backup and updated pos.db were downloaded (${backupName})`;
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false, status.textContent);
      }
      return;
    }
    onFinished();
  });

  refreshHint();
  refreshThumbs();
  showStep(state.step);
}
