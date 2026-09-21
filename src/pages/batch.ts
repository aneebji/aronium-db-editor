import { addSeconds, formatDateTime, insertRows, loadProducts, loadSales, randomSaleOffsetSeconds } from "../lib/aronium";
import { connectedName, getDatabase, persistAndDownloadPair, snapshotBytes } from "../lib/db-file";
import { peekNextBatchId, saveBatch } from "../lib/history";
import { createExtraCashSales, extractDatetimes, matchRows } from "../lib/matcher";
import { extractMany, getLastDeclinedCount, getLastOcrText } from "../lib/ocr";
import { allowedProducts } from "../lib/product-flags";
import { activeBranch, loadSettings } from "../lib/settings";
import { displayStatus, isValidRow, type PaymentMethod, type Product, type TxnRow } from "../types";
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
    <div class="page-head">
      <div>
        <p class="kicker">Intake</p>
        <h1>New batch</h1>
      </div>
    </div>
    <div class="steps">
      <div class="pill" data-step="1">1 Setup</div>
      <div class="pill" data-step="2">2 Extract</div>
      <div class="pill" data-step="3">3 Match</div>
      <div class="pill" data-step="4">4 Sales</div>
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
          <p class="muted">PNG or JPG screenshots of transaction history</p>
          <div class="toolbar" style="justify-content:center">
            <label class="btn">Add images<input id="files" class="hidden" type="file" accept="image/*" multiple></label>
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
        <button class="btn" id="rematch">Rematch random</button>
        <button class="btn ghost" id="extra">Add extra</button>
        <span class="muted grow" id="summary"></span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Skip</th><th>DateTime</th><th>Price</th><th>Payment</th><th>Product code</th><th>Name</th><th>Status</th></tr>
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
  const extra = root.querySelector<HTMLButtonElement>("#extra")!;

  const refreshHint = () => {
    const shop = activeBranch().name;
    root.querySelector("#db-hint")!.textContent = connectedName()
      ? `Using ${shop} · ${connectedName()}`
      : "No database is attached. Open Settings to select a shop and pos.db before matching and writing sales.";
  };

  const refreshThumbs = () => {
    root.querySelector("#count")!.textContent =
      `${state.files.length} ${state.files.length === 1 ? "image" : "images"}`;
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
          <td>
            <input type="checkbox" class="skip-row" data-id="${row.rowId}" aria-label="Skip sale" ${row.skipped ? "checked" : ""} ${state.saleDone ? "disabled" : ""} />
          </td>
          <td>${escapeHtml(row.datetime)}</td>
          <td>${row.amount.toFixed(2)}</td>
          <td>
            <select class="pay" data-id="${row.rowId}" aria-label="Payment" ${state.saleDone ? "disabled" : ""}>
              <option value="debit"${row.paymentMethod !== "cash" ? " selected" : ""}>Debit card</option>
              <option value="cash"${row.paymentMethod === "cash" ? " selected" : ""}>Cash</option>
            </select>
          </td>
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
    body.querySelectorAll<HTMLSelectElement>("select.pay").forEach((select) => {
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        const row = state.rows.find((item) => item.rowId === select.dataset.id);
        if (row) row.paymentMethod = select.value === "cash" ? "cash" : "debit";
      });
    });
    body.querySelectorAll<HTMLInputElement>("input.skip-row").forEach((box) => {
      box.addEventListener("click", (event) => event.stopPropagation());
      box.addEventListener("change", (event) => {
        event.stopPropagation();
        const row = state.rows.find((item) => item.rowId === box.dataset.id);
        if (!row || state.saleDone) return;
        row.skipped = box.checked;
        if (row.skipped) row.result = "";
        refreshTable();
      });
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
    extra.disabled = step !== 3 || state.saleDone;
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
      <label>Payment</label>
      <select id="pay">
        <option value="debit"${row.paymentMethod !== "cash" ? " selected" : ""}>Debit card</option>
        <option value="cash"${row.paymentMethod === "cash" ? " selected" : ""}>Cash</option>
      </select>
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
        alert("Please check the date and amount.");
        return;
      }
      const payment = overlay.querySelector<HTMLSelectElement>("#pay")!.value as PaymentMethod;
      row.datetime =
        formatDateTime(datetime) === formatDateTime(row.originalDatetime)
          ? addSeconds(row.originalDatetime, randomSaleOffsetSeconds())
          : datetime;
      row.amount = Math.round(amount * 100) / 100;
      row.paymentMethod = payment === "cash" ? "cash" : "debit";
      row.status = "ok";
      row.error = "";
      overlay.remove();
      refreshTable();
    });
  };

  const products = (): Product[] => {
    const db = getDatabase();
    if (!db) return [];
    return allowedProducts(loadProducts(db), activeBranch().id);
  };

  const reservedProducts = () => {
    const db = getDatabase();
    if (!db) return [];
    return loadSales(db).map((sale) => ({
      datetime: sale.datetime,
      productId: sale.productId,
      productCode: sale.productCode,
    }));
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
  const drop = root.querySelector("#drop")!;
  drop.addEventListener("dragover", (event) => event.preventDefault());
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles([...(event as DragEvent).dataTransfer?.files ?? []]);
  });
  root.querySelector("#edit")?.addEventListener("click", editSelected);
  rematch.addEventListener("click", () => {
    if (state.step !== 3 || state.saleDone) return;
    matchRows(state.rows, products(), reservedProducts());
    refreshTable();
    status.textContent = "Products rematched at random.";
  });

  const addExtraSales = () => {
    if (state.step !== 3 || state.saleDone) return;
    const dates = extractDatetimes(state.rows);
    if (!dates.length) {
      alert("Extract at least one date first.");
      return;
    }
    if (!products().length) {
      alert("Attach pos.db in Settings before adding extra sales.");
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "dialog";
    overlay.innerHTML = `<div class="card">
      <h3>Add extra sales</h3>
      <label>Extracted date</label>
      <select id="extra-date">
        ${dates.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
      </select>
      <label>How many</label>
      <input id="extra-count" type="number" min="1" max="50" step="1" value="1" />
      <div class="toolbar" style="margin-top:16px">
        <button class="btn" id="apply-extra">Apply</button>
        <button class="btn ghost" id="cancel-extra">Cancel</button>
      </div>
    </div>`;
    document.body.append(overlay);
    overlay.querySelector("#cancel-extra")?.addEventListener("click", () => overlay.remove());
    overlay.querySelector("#apply-extra")?.addEventListener("click", () => {
      const datetime = overlay.querySelector<HTMLSelectElement>("#extra-date")!.value;
      const count = Number(overlay.querySelector<HTMLInputElement>("#extra-count")!.value);
      if (!datetime || !Number.isFinite(count) || count < 1) {
        alert("Choose a date and a count of at least 1.");
        return;
      }
      const extras = createExtraCashSales(
        datetime,
        count,
        products(),
        state.rows.map((row) => row.datetime),
        [
          ...reservedProducts(),
          ...state.rows.map((row) => ({
            datetime: row.datetime,
            productId: row.productId,
            productCode: row.productCode,
          })),
        ],
      );
      if (!extras.length) {
        alert("No products available to add extra sales.");
        return;
      }
      state.rows.push(...extras);
      state.rows.sort((a, b) => b.datetime.localeCompare(a.datetime));
      overlay.remove();
      refreshTable();
      status.textContent = `Added ${extras.length} cash ${extras.length === 1 ? "sale" : "sales"} near ${datetime}.`;
    });
  };
  extra.addEventListener("click", addExtraSales);

  back.addEventListener("click", () => {
    if (state.busy || state.saleDone) return;
    if (state.step === 3) {
      state.rows = state.rows.filter((row) => row.origin !== "extra");
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
        state.rows = (await extractMany(state.files, loadSettings().year)).map((row) => {
          row.paymentMethod = "debit";
          row.origin = "extract";
          return row;
        });
        const declined = getLastDeclinedCount();
        if (!state.rows.length) {
          if (declined) {
            alert(`${declined} declined ${declined === 1 ? "transaction was" : "transactions were"} ignored. No approved sales found.`);
            return;
          }
          const extra = getLastOcrText().trim();
          alert(extra ? `Could not find a date and amount.\n\nOCR text:\n${extra.slice(0, 400)}` : "Could not find a date and amount in the image.");
          return;
        }
        showStep(2);
        status.textContent = declined
          ? `Extracted ${state.rows.length} transactions · ${declined} declined ignored`
          : `Extracted ${state.rows.length} transactions`;
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false, status.textContent);
      }
      return;
    }
    if (state.step === 2) {
      if (!state.rows.some(isValidRow)) {
        alert("At least one valid row is required.");
        return;
      }
      if (!getDatabase()) {
        alert("Attach pos.db in Settings before matching products.");
        return;
      }
      matchRows(state.rows, products(), reservedProducts());
      showStep(3);
      status.textContent = `Matched ${state.rows.filter((row) => row.productId).length} products`;
      return;
    }
    if (state.step === 3) {
      if (state.rows.some((row) => isValidRow(row) && !row.productId)) {
        alert("Some rows have no product. Rematch or skip them.");
        return;
      }
      const db = getDatabase();
      if (!db) {
        alert("Attach pos.db in Settings before writing sales.");
        return;
      }
      if (
        !confirm(
          "Write these sales to pos.db? The original and updated databases will download as a zip. Close Aronium before continuing.",
        )
      ) {
        return;
      }
      setBusy(true, "Writing sales…");
      try {
        const original = snapshotBytes();
        const batchId = peekNextBatchId();
        insertRows(db, state.rows, batchId);
        const { zipName, wroteInPlace } = await persistAndDownloadPair(original);
        saveBatch(connectedName() || "pos.db", state.files.length, state.rows, batchId);
        state.saleDone = true;
        showStep(4);
        status.textContent = wroteInPlace
          ? `Complete. Downloaded ${zipName} (original and updated). Sales tagged as Batch ${batchId}. The attached file was also written in place.`
          : `Complete. Downloaded ${zipName} (original and updated). Sales tagged as Batch ${batchId}.`;
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
