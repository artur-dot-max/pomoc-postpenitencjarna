import Database from "@tauri-apps/plugin-sql";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

type Person = {
  id: number;
  person_uuid?: string;
  request_number?: string;
  request_date?: string;
  assistance_extension_approved?: number;
  correspondence_assistance?: number;
  eligible_person_designation?: string;
  first_name: string;
  last_name: string;
  citizenship?: string;
  pesel?: string;
  birth_date?: string;
  phone?: string;
  email?: string;
  gender?: string;
  ukr_status?: number;
  address?: string;
  identity_document?: string;
  marital_status?: string;
  disability?: string;
  funds_on_release?: number;
  detention_facility?: string;
  incarceration_date?: string;
  release_date?: string;
  info_source?: string;
  assistance_needed?: string;
};

type OrgSettings = {
  id: number;
  org_name?: string;
  center_name?: string;
  contract_number?: string;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
};

type HelpEntry = {
  id: number;
  event_uuid?: string;
  person_id: number;
  help_date?: string;
  help_type?: string;
  help_type_label?: string;
  help_amount?: number;
  help_quantity?: number;
  help_provider?: string;
};

type ImportDbResult = {
  mode: string;
  imported_persons: number;
  imported_help_entries: number;
  imported_users?: number;
  skipped_duplicate_persons?: number;
  skipped_duplicate_help_entries?: number;
};

type ReportSummary = {
  entriesCount: number;
  totalQuantity: number;
  totalAmount: number;
  totalGrossAmount: number;
};

type ReportDataset = {
  kind: "task" | "person" | "all" | "worker";
  fromDate: string;
  toDate: string;
  title: string;
  headers: string[];
  rows: string[][];
  summary: ReportSummary;
};

let excelJsModulePromise: Promise<typeof import("exceljs")> | null = null;

function loadExcelJs() {
  if (!excelJsModulePromise) {
    excelJsModulePromise = import("exceljs");
  }
  return excelJsModulePromise;
}

type AppRole = "Admin" | "Staff" | "ReadOnly";

type AuthUser = {
  id: number;
  username: string;
  role: AppRole;
};

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: AppRole;
  is_active: number;
  first_name?: string;
  last_name?: string;
  position?: string;
};

type LicenseStatus = {
  activated: boolean;
};

type PasswordArchiveResult = {
  archivePath: string;
  inputBytes: number;
  toolUsed: string;
};

let dbPromise: Promise<Database> | null = null;
let dbPathInUse: string | null = null;
const DEFAULT_DB_PATH = "app.db";
const ACTIVE_DB_STORAGE_KEY = "pomoc-postpenitencjarna.active-db-path";
const CONTRACTS_REGISTRY_STORAGE_KEY = "pomoc-postpenitencjarna.contract-databases";
const SESSION_USER_KEY = "sessionUser";
const PASSWORD_RESET_CODE_KEY = "passwordResetCode";
const PASSWORD_RESET_NOTICE_KEY = "passwordResetNotice";
const SELECTED_PERSON_UUID_KEY = "selectedPersonUuid";

type ContractDatabaseRecord = {
  id: number;
  db_path: string;
  contract_number: string | null;
  org_name: string | null;
  center_name: string | null;
  created_at: string;
  updated_at: string;
  is_active: number;
};

const DESIGNATION_LABELS: Record<string, string> = {
  ZWOLNIONA: "Osoba zwolniona z zakładu karnego/aresztu śledczego",
  POZBAWIONA_LUB_ZWALNIANA:
    "Osoba pozbawiona wolności lub zwalniana z zakładu karnego/aresztu śledczego",
  NAJBLIZSZA_POZBAWIONEJ: "Osoba najbliższa osobie pozbawionej wolności",
  NAJBLIZSZA_ZWOLNIONEJ:
    "Osoba najbliższa osobie zwolnionej z zakładu karnego/aresztu śledczego",
};

const HELP_TYPE_OPTIONS = [
  ["1", "1) pokrywanie kosztów czasowego zakwaterowania lub udzielanie schronienia w ośrodku dla bezdomnych;"],
  [
    "2",
    "2) okresową dopłatę do bieżących zobowiązań czynszowych i opłat za energię cieplną, energię elektryczną, gaz, wodę, opał, odbiór nieczystości stałych i płynnych za lokal mieszkalny lub dom jednorodzinny, do którego osoba uprawniona posiada tytuł prawny, proporcjonalnie do liczby osób stale zamieszkujących w tym lokalu lub domu;",
  ],
  ["3", "3) organizowanie i finansowanie poradnictwa prawnego, promocji zatrudnienia i aktywizacji zawodowej;"],
  [
    "4",
    "4) organizowanie i finansowanie szkoleń i kursów podnoszących kwalifikacje zawodowe oraz pokrywanie kosztów egzaminów potwierdzających kwalifikacje zawodowe;",
  ],
  [
    "5",
    "5) organizowanie i finansowanie programów podnoszących kompetencje społeczne, mających na celu przeciwdziałanie czynnikom kryminogennym, a zwłaszcza agresji i przemocy, w tym przemocy w rodzinie, oraz problemom uzależnień;",
  ],
  [
    "6",
    "6) zakup materiałów, narzędzi, wyposażenia oraz urządzeń niezbędnych do realizacji programów, o których mowa w pkt 5, oraz szkoleń i kursów podnoszących kwalifikacje zawodowe, a także wykonywania pracy nieodpłatnej;",
  ],
  [
    "7",
    "7) pokrywanie kosztów związanych ze specjalistycznym leczeniem lub rehabilitacją leczniczą oraz uzyskiwaniem orzeczeń o niepełnosprawności, stopniu niepełnosprawności lub niezdolności do pracy;",
  ],
  [
    "8",
    "8) pokrywanie kosztów transportu specjalnego, zgodnie ze wskazaniami lekarskimi, lub przejazdów do miejsca pobytu, nauki, terapii, pracy, zwłaszcza wykonywanej nieodpłatnie;",
  ],
  [
    "9",
    "9) pokrywanie kosztów związanych z uzyskaniem dowodu osobistego oraz innych dokumentów niezbędnych do uzyskania pomocy;",
  ],
  [
    "10",
    "10) pokrywanie kosztów badań specjalistycznych wymaganych przy kwalifikowaniu do udziału w programach, o których mowa w pkt 5, szkoleniach i kursach podnoszących kwalifikacje zawodowe oraz pracy wykonywanej nieodpłatnie;",
  ],
  [
    "11",
    "11) pokrywanie kosztów grupowego ubezpieczenia od następstw nieszczęśliwych wypadków osób zakwalifikowanych do udziału w szkoleniach i kursach podnoszących kwalifikacje zawodowe, programach, o których mowa w pkt 5, oraz pracy wykonywanej nieodpłatnie;",
  ],
  [
    "12",
    "12) promowanie i wspieranie inicjatyw i przedsięwzięć służących skutecznej readaptacji skazanych, działań o charakterze edukacyjnym i informacyjnym, organizowanie i prowadzenie szkoleń, organizowanie i zlecanie badań naukowych dotyczących sytuacji osób skazanych;",
  ],
  [
    "13a",
    "13a) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie żywności lub bonów żywnościowych,",
  ],
  [
    "13b",
    "13b) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie odzieży, bielizny, obuwia, środków czystości i higieny osobistej lub bonów towarowych,",
  ],
  [
    "13c",
    "13c) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie biletów komunikacji publicznej,",
  ],
  [
    "13d",
    "13d) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie leków, środków opatrunkowych i sanitarnych,",
  ],
  [
    "13e",
    "13e) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie wyrobów medycznych, w tym protez, przedmiotów ortopedycznych i środków pomocniczych,",
  ],
  [
    "13f",
    "13f) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie pomocy naukowych, dydaktycznych, książek i materiałów biurowych,",
  ],
  [
    "13g",
    "13g) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie niezbędnych przedmiotów wyposażenia domowego lub innych przedmiotów użytku osobistego ułatwiających funkcjonowanie społeczne w miejscu zamieszkania lub pobytu, zwłaszcza osób niepełnosprawnych,",
  ],
  [
    "13h",
    "13h) pokrywanie kosztów związanych z organizacją i udzielaniem pomocy rzeczowej w formie materiałów, narzędzi i wyposażenia niezbędnego do uczestnictwa w szkoleniu zawodowym, wykonywania wyuczonego zawodu albo prowadzenia działalności gospodarczej na własny rachunek",
  ],
  ["14", "14) udzielanie świadczeń pieniężnych na cel wskazany przez organ lub podmiot udzielający pomocy"],
] as const;

function nowIsoUtc() {
  return new Date().toISOString();
}

function getActiveDbPath() {
  const saved = window.localStorage.getItem(ACTIVE_DB_STORAGE_KEY);
  return (saved ?? DEFAULT_DB_PATH).trim() || DEFAULT_DB_PATH;
}

function rememberActiveDbPath(path: string) {
  const nextPath = (path ?? "").trim() || DEFAULT_DB_PATH;
  window.localStorage.setItem(ACTIVE_DB_STORAGE_KEY, nextPath);
}

async function closeDb() {
  const currentPromise = dbPromise;
  dbPromise = null;
  dbPathInUse = null;
  if (!currentPromise) return;

  try {
    const db = await currentPromise;
    await db.close();
  } catch (error) {
    const message = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
    if (!message.includes("closed pool")) {
      throw error;
    }
  }
}

function getDb() {
  const activePath = getActiveDbPath();
  if (!dbPromise || dbPathInUse !== activePath) {
    dbPathInUse = activePath;
    dbPromise = Database.load(`sqlite:${activePath}`);
  }
  return dbPromise;
}

function sanitizeDbPathPart(value: string) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function loadContractRegistry(): ContractDatabaseRecord[] {
  try {
    const raw = window.localStorage.getItem(CONTRACTS_REGISTRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ContractDatabaseRecord[]) : [];
  } catch {
    return [];
  }
}

function saveContractRegistry(records: ContractDatabaseRecord[]) {
  window.localStorage.setItem(CONTRACTS_REGISTRY_STORAGE_KEY, JSON.stringify(records));
}

function upsertContractRegistryRecord(dbPath: string, org: Partial<OrgSettings>, isActive: boolean) {
  const now = nowIsoUtc();
  const existing = loadContractRegistry();
  const others = existing.filter((item) => item.db_path !== dbPath);
  const current = existing.find((item) => item.db_path === dbPath);
  const next: ContractDatabaseRecord = {
    id: current?.id ?? Date.now(),
    db_path: dbPath,
    contract_number: (org.contract_number ?? "").trim() || null,
    org_name: (org.org_name ?? "").trim() || null,
    center_name: (org.center_name ?? "").trim() || null,
    created_at: current?.created_at ?? now,
    updated_at: now,
    is_active: isActive ? 1 : 0,
  };
  const normalizedOthers = isActive ? others.map((item) => ({ ...item, is_active: 0 })) : others;
  saveContractRegistry(
    [...normalizedOthers, next].sort(
      (a, b) => b.is_active - a.is_active || b.updated_at.localeCompare(a.updated_at)
    )
  );
}

function removeContractRegistryRecord(dbPath: string) {
  const existing = loadContractRegistry();
  saveContractRegistry(existing.filter((item) => item.db_path !== dbPath));
}

async function syncCurrentContractRegistry() {
  await ensureOrgTable();
  const db = await getDb();
  const rows = await db.select<OrgSettings[]>(
    "SELECT id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email FROM organization_settings WHERE id = 1 LIMIT 1"
  );
  upsertContractRegistryRecord(getActiveDbPath(), rows[0] ?? {}, true);
}

async function getCurrentOrgSettings() {
  await ensureOrgTable();
  const db = await getDb();
  const rows = await db.select<OrgSettings[]>(
    "SELECT id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email FROM organization_settings WHERE id = 1 LIMIT 1"
  );
  return rows[0] ?? null;
}

async function renderActiveContractBanner() {
  const heroContent = document.querySelector<HTMLElement>(".hero-content");
  const shouldRender =
    document.querySelector("#person-form") !== null || document.querySelector("#reports-page") !== null;
  if (!heroContent || !shouldRender) return;

  const org = await getCurrentOrgSettings();
  const contractLabel = escapeHtml((org?.contract_number ?? "").trim() || "brak numeru umowy");
  let banner = document.querySelector<HTMLDivElement>("#active-contract-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "active-contract-banner";
    banner.className = "active-contract-banner";
    heroContent.append(banner);
  }

  banner.innerHTML = `
    <div class="active-contract-label">Aktywna umowa</div>
    <div class="active-contract-value">${contractLabel}</div>
    <div class="active-contract-meta">Pracujesz na aktualnie wybranej bazie umowy</div>
  `;
}

function setDetailItem(label: string, value: string) {
  return `<div class="detail-item"><span>${label}</span><div>${value || "-"}</div></div>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

const DATE_MIN_VALUE = "1940-01-01";
const DATE_MAX_VALUE = "2050-12-31";
const DATE_MIN = new Date(1940, 0, 1);
const DATE_MAX = new Date(2050, 11, 31);

function isDateWithinAllowedRange(value: string) {
  if (!value) return true;
  const parsed = parseDateInput(value);
  if (!parsed) return false;
  return parsed >= DATE_MIN && parsed <= DATE_MAX;
}

type PeselValidationResult = {
  isValid: boolean;
  normalized: string;
  error?: string;
};

function validatePesel(rawValue: string): PeselValidationResult {
  const normalized = rawValue.replace(/\s+/g, "").replace(/-/g, "");
  if (!normalized) {
    return { isValid: true, normalized: "" };
  }
  if (!/^\d{11}$/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: "Numer PESEL musi składać się z dokładnie 11 cyfr.",
    };
  }

  const yearPart = Number(normalized.slice(0, 2));
  const monthPart = Number(normalized.slice(2, 4));
  const dayPart = Number(normalized.slice(4, 6));

  let fullYear = 1900 + yearPart;
  let month = monthPart;
  if (monthPart >= 1 && monthPart <= 12) {
    fullYear = 1900 + yearPart;
    month = monthPart;
  } else if (monthPart >= 21 && monthPart <= 32) {
    fullYear = 2000 + yearPart;
    month = monthPart - 20;
  } else if (monthPart >= 41 && monthPart <= 52) {
    fullYear = 2100 + yearPart;
    month = monthPart - 40;
  } else if (monthPart >= 61 && monthPart <= 72) {
    fullYear = 2200 + yearPart;
    month = monthPart - 60;
  } else if (monthPart >= 81 && monthPart <= 92) {
    fullYear = 1800 + yearPart;
    month = monthPart - 80;
  } else {
    return {
      isValid: false,
      normalized,
      error: "Numer PESEL zawiera nieprawidłowy miesiąc w części daty urodzenia.",
    };
  }

  const date = new Date(fullYear, month - 1, dayPart);
  const isValidDate =
    date.getFullYear() === fullYear && date.getMonth() === month - 1 && date.getDate() === dayPart;
  if (!isValidDate) {
    return {
      isValid: false,
      normalized,
      error: "Numer PESEL zawiera nieprawidłowy dzień w części daty urodzenia.",
    };
  }

  const digits = normalized.split("").map(Number);
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const weightedSum = weights.reduce((sum, weight, index) => sum + weight * digits[index], 0);
  const controlDigit = (10 - (weightedSum % 10)) % 10;
  if (controlDigit !== digits[10]) {
    return {
      isValid: false,
      normalized,
      error: "Numer PESEL ma nieprawidłową cyfrę kontrolną.",
    };
  }

  return { isValid: true, normalized };
}

function ensurePeselLiveMessage(input: HTMLInputElement) {
  const parent = input.parentElement;
  if (!parent) return null;
  let message = parent.querySelector<HTMLDivElement>(".pesel-live-message");
  if (!message) {
    message = document.createElement("div");
    message.className = "save-message pesel-live-message";
    message.hidden = true;
    input.insertAdjacentElement("afterend", message);
  }
  return message;
}

function attachPeselLiveValidation(input: HTMLInputElement | null) {
  if (!input) return;
  const message = ensurePeselLiveMessage(input);

  const update = (showBrowserMessage: boolean) => {
    const value = input.value.trim();
    const result = validatePesel(value);
    if (!result.isValid) {
      const text = result.error ?? "Podano nieprawidłowy numer PESEL.";
      input.setCustomValidity(text);
      if (message) {
        message.textContent = text;
        message.hidden = false;
        message.classList.remove("success");
        message.classList.add("error");
      }
      if (showBrowserMessage) {
        input.reportValidity();
      }
      return;
    }

    input.setCustomValidity("");
    if (message) {
      message.textContent = "";
      message.hidden = true;
      message.classList.remove("error");
    }
  };

  input.addEventListener("input", () => update(false));
  input.addEventListener("blur", () => update(true));
  update(false);
}

function addMonths(baseDate: Date, months: number) {
  const date = new Date(baseDate.getTime());
  date.setMonth(date.getMonth() + months);
  return date;
}

function formatDatePl(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function getPersonSupportPeriod(person: Pick<Person, "eligible_person_designation" | "release_date" | "assistance_extension_approved">) {
  const limitedAssistanceDesignations = new Set(["ZWOLNIONA", "NAJBLIZSZA_ZWOLNIONEJ"]);
  const designation = person.eligible_person_designation ?? "";
  if (!limitedAssistanceDesignations.has(designation)) {
    return null;
  }
  const releaseDate = parseDateInput(person.release_date ?? "");
  if (!releaseDate) {
    return { error: "brak daty zwolnienia" };
  }
  const supportMonths = person.assistance_extension_approved === 1 ? 12 : 6;
  return {
    from: releaseDate,
    to: addMonths(releaseDate, supportMonths),
    supportMonths,
  };
}

function validateHelpDateForPerson(helpDateValue: string, person: Pick<Person, "eligible_person_designation" | "release_date" | "assistance_extension_approved">) {
  const helpDate = parseDateInput(helpDateValue);
  if (!helpDate) {
    return { isValid: false, message: "Podaj prawidłową datę udzielonej pomocy." };
  }
  const period = getPersonSupportPeriod(person);
  if (!period) {
    return { isValid: true };
  }
  if ("error" in period) {
    return {
      isValid: false,
      message: "Dla tej osoby nie można zweryfikować okresu pomocy, ponieważ brakuje daty zwolnienia.",
    };
  }
  if (helpDate < period.from || helpDate > period.to) {
    return {
      isValid: false,
      message: `Data udzielonej pomocy musi mieścić się w okresie od ${formatDatePl(
        period.from
      )} do ${formatDatePl(period.to)}.`,
    };
  }
  return { isValid: true };
}

function toLoginToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function createUuid() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createHelpEventUuid() {
  return createUuid();
}

function mapPersonToDataset(row: HTMLDivElement, person: Person) {
  row.dataset.id = String(person.id);
  row.dataset.personUuid = person.person_uuid ?? "";
  row.dataset.requestNumber = person.request_number ?? "";
  row.dataset.fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Bez imienia";
  row.dataset.lastName = person.last_name ?? "";
  row.dataset.pesel = person.pesel ?? "-";
  row.dataset.phone = person.phone ?? "-";
  row.dataset.releaseDate = person.release_date ?? "-";
  row.dataset.designationLabel = person.eligible_person_designation
    ? (DESIGNATION_LABELS[person.eligible_person_designation] ?? person.eligible_person_designation)
    : "-";
  row.dataset.citizenship = person.citizenship ?? "";
  row.dataset.birthDate = person.birth_date ?? "";
  row.dataset.email = person.email ?? "";
  row.dataset.gender = person.gender ?? "";
  row.dataset.ukr = person.ukr_status === 1 ? "Tak" : "Nie";
  row.dataset.address = person.address ?? "";
  row.dataset.identityDoc = person.identity_document ?? "";
  row.dataset.maritalStatus = person.marital_status ?? "";
  row.dataset.disability = person.disability ?? "";
  row.dataset.funds = person.funds_on_release?.toString() ?? "";
  row.dataset.detention = person.detention_facility ?? "";
  row.dataset.incarcerationDate = person.incarceration_date ?? "";
  row.dataset.infoSource = person.info_source ?? "";
  row.dataset.assistanceNeeded = person.assistance_needed ?? "";
}

function createListRow(person: Person) {
  const row = document.createElement("div");
  row.className = "list-row";
  mapPersonToDataset(row, person);
  row.innerHTML = `
    <span>${row.dataset.fullName}</span>
    <span>${row.dataset.pesel}</span>
    <span>${row.dataset.phone}</span>
    <span>${row.dataset.designationLabel}</span>
  `;
  return row;
}

function applyFilters(
  list: HTMLDivElement,
  lastNameQuery: string,
  peselQuery: string,
  options?: {
    page?: number;
    pageSize?: number;
    pageInfo?: HTMLElement | null;
    prevButton?: HTMLButtonElement | null;
    nextButton?: HTMLButtonElement | null;
  }
) {
  const matchingRows: HTMLDivElement[] = [];
  Array.from(list.children).forEach((child) => {
    const row = child as HTMLDivElement;
    if (row.classList.contains("muted") || row.id === "no-results") {
      return;
    }

    const lastName = (row.dataset.lastName ?? "").toLowerCase();
    const fullName = (row.dataset.fullName ?? "").toLowerCase();
    const pesel = (row.dataset.pesel ?? "").toLowerCase();

    const matchesLastName =
      !lastNameQuery || lastName.includes(lastNameQuery) || fullName.includes(lastNameQuery);
    const matchesPesel = !peselQuery || pesel.includes(peselQuery);
    if (matchesLastName && matchesPesel) {
      matchingRows.push(row);
    }
    row.style.display = "none";
  });

  const pageSize = options?.pageSize ?? (matchingRows.length || 1);
  const totalPages = Math.max(1, Math.ceil(matchingRows.length / pageSize));
  const currentPage = Math.min(Math.max(1, options?.page ?? 1), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  matchingRows.slice(startIndex, startIndex + pageSize).forEach((row) => {
    row.style.display = "grid";
  });

  let noResults = list.querySelector<HTMLDivElement>("#no-results");
  if (matchingRows.length === 0 && (lastNameQuery || peselQuery)) {
    if (!noResults) {
      noResults = document.createElement("div");
      noResults.id = "no-results";
      noResults.className = "list-row muted";
      noResults.innerHTML = `
        <span>Brak wyników</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
      `;
      list.append(noResults);
    }
  } else if (noResults) {
    noResults.remove();
  }

  if (options?.pageInfo) {
    options.pageInfo.textContent = matchingRows.length
      ? `Strona ${currentPage} z ${totalPages}`
      : "Strona 0 z 0";
  }
  if (options?.prevButton) {
    options.prevButton.disabled = currentPage <= 1 || matchingRows.length === 0;
  }
  if (options?.nextButton) {
    options.nextButton.disabled = currentPage >= totalPages || matchingRows.length === 0;
  }
  return { currentPage, totalPages, visibleCount: matchingRows.length };
}

async function loadPersons(list: HTMLDivElement) {
  const db = await getDb();
  const persons = await db.select<Person[]>(
    "SELECT * FROM authorized_persons ORDER BY id DESC"
  );

  list.innerHTML = "";
  if (!persons.length) {
    const empty = document.createElement("div");
    empty.className = "list-row muted";
    empty.innerHTML = `
      <span>Brak zapisanych osób</span>
      <span>-</span>
      <span>-</span>
      <span>-</span>
    `;
    list.append(empty);
    return;
  }

  persons.forEach((person) => {
    list.append(createListRow(person));
  });
}

function renderDetail(
  person: Person,
  detailName: HTMLElement,
  detailMeta: HTMLElement | null,
  detailPesel: HTMLElement | null,
  detailSupportDeadline: HTMLElement | null,
  detailBasic: HTMLDivElement,
  detailCase: HTMLDivElement
) {
  const firstName = person.first_name?.trim() || "-";
  const lastName = person.last_name?.trim() || "-";
  const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Dane osoby";
  const pesel = person.pesel ?? "-";
  const releaseDate = person.release_date ?? "-";
  const designationLabel = person.eligible_person_designation
    ? (DESIGNATION_LABELS[person.eligible_person_designation] ?? person.eligible_person_designation)
    : "-";
  const limitedAssistanceDesignations = new Set(["ZWOLNIONA", "NAJBLIZSZA_ZWOLNIONEJ"]);

  detailName.textContent = `Imię i nazwisko: ${firstName} ${lastName}`;
  if (detailMeta) {
    detailMeta.textContent = `Oznaczenie osoby uprawnionej: ${designationLabel}`;
  }
  if (detailPesel) {
    detailPesel.textContent = `PESEL: ${pesel}`;
  }
  if (detailSupportDeadline) {
    const designation = person.eligible_person_designation ?? "";
    const supportsLimitedPeriod = limitedAssistanceDesignations.has(designation);
    if (!supportsLimitedPeriod) {
      detailSupportDeadline.textContent = "Okres udzielania pomocy kończy się dnia: nie dotyczy";
    } else {
      const releaseDateValue = person.release_date ?? "";
      const releaseDate = parseDateInput(releaseDateValue);
      if (!releaseDate) {
        detailSupportDeadline.textContent = "Okres udzielania pomocy kończy się dnia: brak daty zwolnienia";
      } else {
        const supportMonths = person.assistance_extension_approved === 1 ? 12 : 6;
        const supportDeadline = addMonths(releaseDate, supportMonths);
        detailSupportDeadline.innerHTML = `Okres udzielania pomocy kończy się dnia: <strong>${formatDatePl(
          supportDeadline
        )}</strong>`;
      }
    }
  }

  detailBasic.innerHTML = [
    setDetailItem("Imię i nazwisko", fullName),
    setDetailItem("Nr wniosku", person.request_number ?? ""),
    setDetailItem("Data wniosku", person.request_date ?? ""),
    setDetailItem("Obywatelstwo", person.citizenship ?? ""),
    setDetailItem("PESEL", pesel),
    setDetailItem("Data urodzenia", person.birth_date ?? ""),
    setDetailItem("Email", person.email ?? ""),
    setDetailItem("Płeć", person.gender ?? ""),
    setDetailItem("Status UKR", person.ukr_status === 1 ? "Tak" : "Nie"),
    setDetailItem("Adres", person.address ?? ""),
    setDetailItem("Dokument tożsamości", person.identity_document ?? ""),
  ].join("");

  detailCase.innerHTML = [
    setDetailItem("Oznaczenie osoby uprawnionej", designationLabel),
    setDetailItem("Stan cywilny", person.marital_status ?? ""),
    setDetailItem("Niepełnosprawność", person.disability ?? ""),
    setDetailItem("Środki przy zwolnieniu", person.funds_on_release?.toString() ?? ""),
    setDetailItem("Zakład karny / areszt", person.detention_facility ?? ""),
    setDetailItem("Data osadzenia", person.incarceration_date ?? ""),
    setDetailItem("Data zwolnienia", releaseDate),
    setDetailItem("Źródło informacji", person.info_source ?? ""),
    setDetailItem(
      "Czy udzielono pomocy korespondencyjnej",
      person.correspondence_assistance === 1 ? "Tak" : "Nie"
    ),
    setDetailItem("Uwagi", person.assistance_needed ?? ""),
  ].join("");
}

function fillEditForm(editForm: HTMLFormElement, person: Person) {
  (editForm.elements.namedItem("request_number") as HTMLInputElement).value =
    person.request_number ?? "";
  (editForm.elements.namedItem("request_date") as HTMLInputElement).value = person.request_date ?? "";
  (editForm.elements.namedItem("assistance_extension_approved") as HTMLInputElement).checked =
    person.assistance_extension_approved === 1;
  (editForm.elements.namedItem("eligible_person_designation") as HTMLSelectElement).value =
    person.eligible_person_designation ?? "";
  (editForm.elements.namedItem("first_name") as HTMLInputElement).value = person.first_name ?? "";
  (editForm.elements.namedItem("last_name") as HTMLInputElement).value = person.last_name ?? "";
  (editForm.elements.namedItem("citizenship") as HTMLSelectElement).value = person.citizenship ?? "";
  (editForm.elements.namedItem("pesel") as HTMLInputElement).value = person.pesel ?? "";
  (editForm.elements.namedItem("birth_date") as HTMLInputElement).value = person.birth_date ?? "";
  (editForm.elements.namedItem("phone") as HTMLInputElement).value = person.phone ?? "";
  (editForm.elements.namedItem("email") as HTMLInputElement).value = person.email ?? "";
  (editForm.elements.namedItem("gender") as HTMLSelectElement).value = person.gender ?? "";
  (editForm.elements.namedItem("ukr_status") as HTMLInputElement).checked = person.ukr_status === 1;
  (editForm.elements.namedItem("address") as HTMLTextAreaElement).value = person.address ?? "";
  (editForm.elements.namedItem("identity_document") as HTMLInputElement).value =
    person.identity_document ?? "";
  (editForm.elements.namedItem("marital_status") as HTMLSelectElement).value =
    person.marital_status ?? "";
  (editForm.elements.namedItem("disability") as HTMLInputElement).value = person.disability ?? "";
  (editForm.elements.namedItem("funds_on_release") as HTMLInputElement).value =
    person.funds_on_release?.toString() ?? "";
  (editForm.elements.namedItem("detention_facility") as HTMLSelectElement).value =
    person.detention_facility ?? "";
  (editForm.elements.namedItem("incarceration_date") as HTMLInputElement).value =
    person.incarceration_date ?? "";
  (editForm.elements.namedItem("release_date") as HTMLInputElement).value =
    person.release_date ?? "";
  (editForm.elements.namedItem("info_source") as HTMLInputElement).value = person.info_source ?? "";
  (editForm.elements.namedItem("correspondence_assistance") as HTMLInputElement).checked =
    person.correspondence_assistance === 1;
  (editForm.elements.namedItem("assistance_needed") as HTMLTextAreaElement).value =
    person.assistance_needed ?? "";
}

async function ensureOrgTable() {
  const db = await getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS organization_settings (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      org_name       TEXT,
      center_name    TEXT,
      contract_number TEXT,
      contact_person TEXT,
      contact_phone  TEXT,
      contact_email  TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  type TableInfoRow = { name: string };
  const columns = await db.select<TableInfoRow[]>("PRAGMA table_info(organization_settings)");
  const hasContractNumber = columns.some((column) => column.name === "contract_number");
  if (!hasContractNumber) {
    await db.execute("ALTER TABLE organization_settings ADD COLUMN contract_number TEXT");
  }
}

async function ensureHelpTable() {
  const db = await getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS person_help_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid      TEXT UNIQUE,
      person_id       INTEGER NOT NULL,
      help_date       TEXT,
      help_type       TEXT,
      help_type_label TEXT,
      help_amount     REAL,
      help_quantity   REAL,
      help_provider   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  type TableInfoRow = { name: string };
  const columns = await db.select<TableInfoRow[]>("PRAGMA table_info(person_help_entries)");
  const hasEventUuid = columns.some((column) => column.name === "event_uuid");
  if (!hasEventUuid) {
    await db.execute("ALTER TABLE person_help_entries ADD COLUMN event_uuid TEXT");
  }
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_person_help_entries_event_uuid ON person_help_entries(event_uuid)"
  );
  const rowsWithoutUuid = await db.select<Array<{ id: number }>>(
    `SELECT id
     FROM person_help_entries
     WHERE event_uuid IS NULL OR TRIM(COALESCE(event_uuid, '')) = ''`
  );
  for (const row of rowsWithoutUuid) {
    await db.execute("UPDATE person_help_entries SET event_uuid = ? WHERE id = ?", [
      createHelpEventUuid(),
      row.id,
    ]);
  }
}

async function ensureIndivisibleHelpTable() {
  const db = await getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS indivisible_help_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_uuid      TEXT UNIQUE,
      help_date       TEXT,
      entry_date      TEXT,
      help_type       TEXT,
      help_type_label TEXT,
      help_amount     REAL,
      help_quantity   REAL,
      reason          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_indivisible_help_entries_uuid ON indivisible_help_entries(entry_uuid)"
  );
  type TableInfoRow = { name: string };
  const columns = await db.select<TableInfoRow[]>("PRAGMA table_info(indivisible_help_entries)");
  const hasHelpTypeLabel = columns.some((column) => column.name === "help_type_label");
  if (!hasHelpTypeLabel) {
    await db.execute("ALTER TABLE indivisible_help_entries ADD COLUMN help_type_label TEXT");
  }
}

async function ensureUsersTable() {
  const db = await getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK(role IN ('Admin','Staff','ReadOnly')),
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  type TableInfoRow = { name: string };
  const columns = await db.select<TableInfoRow[]>("PRAGMA table_info(users)");
  const hasFirstName = columns.some((column) => column.name === "first_name");
  const hasLastName = columns.some((column) => column.name === "last_name");
  const hasPosition = columns.some((column) => column.name === "position");
  if (!hasFirstName) await db.execute("ALTER TABLE users ADD COLUMN first_name TEXT");
  if (!hasLastName) await db.execute("ALTER TABLE users ADD COLUMN last_name TEXT");
  if (!hasPosition) await db.execute("ALTER TABLE users ADD COLUMN position TEXT");
}

async function ensureDefaultUsers() {
  await ensureUsersTable();
  const db = await getDb();
  const defaults: Array<{ username: string; role: AppRole }> = [
    { username: "admin", role: "Admin" },
    { username: "pracownik", role: "Staff" },
  ];
  for (const user of defaults) {
    const existing = await db.select<UserRow[]>(
      "SELECT id, username, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1",
      [user.username]
    );
    if (!existing.length) {
      await db.execute(
        "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
        [user.username, "Temp1234", user.role]
      );
    }
  }
}

async function snapshotUsers() {
  await ensureUsersTable();
  const db = await getDb();
  return db.select<UserRow[]>(
    "SELECT id, username, password_hash, role, is_active, first_name, last_name, position FROM users ORDER BY id ASC"
  );
}

async function seedUsers(users: UserRow[]) {
  await ensureUsersTable();
  const db = await getDb();
  if (!users.length) {
    await ensureDefaultUsers();
    return;
  }

  for (const user of users) {
    await db.execute(
      `INSERT OR IGNORE INTO users (
        username, password_hash, role, is_active, first_name, last_name, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        user.username,
        user.password_hash,
        user.role,
        user.is_active,
        user.first_name ?? null,
        user.last_name ?? null,
        user.position ?? null,
      ]
    );
  }
}

async function ensureAuthorizedPersonsSchemaUpgrades() {
  const db = await getDb();
  await db.execute(
    `CREATE TABLE IF NOT EXISTS authorized_persons (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      person_uuid               TEXT UNIQUE,
      request_number            TEXT,
      request_date              TEXT,
      assistance_extension_approved INTEGER NOT NULL DEFAULT 0,
      correspondence_assistance INTEGER NOT NULL DEFAULT 0,
      first_name                TEXT NOT NULL,
      last_name                 TEXT NOT NULL,
      eligible_person_designation TEXT,
      citizenship               TEXT,
      pesel                     TEXT,
      birth_date                TEXT,
      phone                     TEXT,
      email                     TEXT,
      gender                    TEXT,
      ukr_status                INTEGER NOT NULL DEFAULT 0,
      address                   TEXT,
      identity_document         TEXT,
      marital_status            TEXT,
      disability                TEXT,
      funds_on_release          REAL,
      detention_facility        TEXT,
      incarceration_date        TEXT,
      release_date              TEXT,
      info_source               TEXT,
      assistance_needed         TEXT,
      created_at                TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
  type TableInfoRow = { name: string };
  const columns = await db.select<TableInfoRow[]>("PRAGMA table_info(authorized_persons)");
  const hasDesignationColumn = columns.some((column) => column.name === "eligible_person_designation");
  const hasPersonUuidColumn = columns.some((column) => column.name === "person_uuid");
  const hasRequestNumberColumn = columns.some((column) => column.name === "request_number");
  const hasRequestDateColumn = columns.some((column) => column.name === "request_date");
  const hasAssistanceExtensionColumn = columns.some(
    (column) => column.name === "assistance_extension_approved"
  );
  const hasCorrespondenceAssistanceColumn = columns.some(
    (column) => column.name === "correspondence_assistance"
  );
  if (!hasDesignationColumn) {
    await db.execute("ALTER TABLE authorized_persons ADD COLUMN eligible_person_designation TEXT");
  }
  if (!hasPersonUuidColumn) {
    await db.execute("ALTER TABLE authorized_persons ADD COLUMN person_uuid TEXT");
  }
  if (!hasRequestNumberColumn) {
    await db.execute("ALTER TABLE authorized_persons ADD COLUMN request_number TEXT");
  }
  if (!hasRequestDateColumn) {
    await db.execute("ALTER TABLE authorized_persons ADD COLUMN request_date TEXT");
    await db.execute(
      "UPDATE authorized_persons SET request_date = substr(created_at, 1, 10) WHERE request_date IS NULL"
    );
  }
  if (!hasAssistanceExtensionColumn) {
    await db.execute(
      "ALTER TABLE authorized_persons ADD COLUMN assistance_extension_approved INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!hasCorrespondenceAssistanceColumn) {
    await db.execute(
      "ALTER TABLE authorized_persons ADD COLUMN correspondence_assistance INTEGER NOT NULL DEFAULT 0"
    );
  }
  const personsWithoutUuid = await db.select<Array<{ id: number }>>(
    `SELECT id
     FROM authorized_persons
     WHERE person_uuid IS NULL OR TRIM(COALESCE(person_uuid, '')) = ''`
  );
  for (const person of personsWithoutUuid) {
    await db.execute("UPDATE authorized_persons SET person_uuid = ? WHERE id = ?", [
      createUuid(),
      person.id,
    ]);
  }
  await db.execute("DROP INDEX IF EXISTS idx_authorized_persons_pesel_unique");
  await db.execute("DROP INDEX IF EXISTS idx_authorized_persons_pesel_request_date_unique");
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_authorized_persons_person_uuid_unique
     ON authorized_persons(person_uuid)
     WHERE person_uuid IS NOT NULL AND TRIM(COALESCE(person_uuid, '')) <> ''`
  );
}

window.addEventListener("DOMContentLoaded", () => {
  void (async () => {
    document.querySelectorAll<HTMLInputElement>("input[type='date']").forEach((input) => {
      input.min = DATE_MIN_VALUE;
      input.max = DATE_MAX_VALUE;
    });

    const form = document.querySelector<HTMLFormElement>("#person-form");
    const list = document.querySelector<HTMLDivElement>("#people-list");
    const filterLastName = document.querySelector<HTMLInputElement>("#filter-last-name");
    const filterPesel = document.querySelector<HTMLInputElement>("#filter-pesel");
    const clearFilters = document.querySelector<HTMLButtonElement>("#clear-filters");
    const peoplePrevPage = document.querySelector<HTMLButtonElement>("#people-prev-page");
    const peopleNextPage = document.querySelector<HTMLButtonElement>("#people-next-page");
    const peoplePageInfo = document.querySelector<HTMLSpanElement>("#people-page-info");
    const navOrg = document.querySelector<HTMLButtonElement>("#nav-org");
    const navStaff = document.querySelector<HTMLButtonElement>("#nav-staff");
    const navReports = document.querySelector<HTMLButtonElement>("#nav-reports");
    const navLogout = document.querySelector<HTMLButtonElement>("#nav-logout");
    const navExit = document.querySelector<HTMLButtonElement>("#nav-exit");
    const togglePersonForm = document.querySelector<HTMLButtonElement>("#toggle-person-form");
    const personPanel = document.querySelector<HTMLDivElement>("#person-panel");
    const personFormMeta = togglePersonForm?.querySelector<HTMLSpanElement>(".accordion-meta");
    const toggleSharedHelp = document.querySelector<HTMLButtonElement>("#toggle-shared-help");
    const sharedHelpPanel = document.querySelector<HTMLDivElement>("#shared-help-panel");
    const sharedHelpMeta = toggleSharedHelp?.querySelector<HTMLSpanElement>(".accordion-meta");
    const sharedHelpForm = document.querySelector<HTMLFormElement>("#shared-help-form");
    const sharedHelpPeopleList = document.querySelector<HTMLDivElement>("#shared-help-people-list");
    const sharedHelpSummary = document.querySelector<HTMLDivElement>("#shared-help-summary");
    const sharedHelpMessage = document.querySelector<HTMLDivElement>("#shared-help-message");
    const sharedHelpTypeSelect = document.querySelector<HTMLSelectElement>("#shared-help-type");
    const sharedHelpFilterName = document.querySelector<HTMLInputElement>("#shared-help-filter-name");
    const sharedHelpFilterPesel = document.querySelector<HTMLInputElement>("#shared-help-filter-pesel");
    const sharedHelpClearFilters =
      document.querySelector<HTMLButtonElement>("#shared-help-clear-filters");
    const sharedHelpSelectedCount =
      document.querySelector<HTMLSpanElement>("#shared-help-selected-count");
    const sharedHelpClearSelection =
      document.querySelector<HTMLButtonElement>("#shared-help-clear-selection");
    const sharedHelpPrevPage = document.querySelector<HTMLButtonElement>("#shared-help-prev-page");
    const sharedHelpNextPage = document.querySelector<HTMLButtonElement>("#shared-help-next-page");
    const sharedHelpPageInfo = document.querySelector<HTMLSpanElement>("#shared-help-page-info");
    const toggleIndivisibleHelp = document.querySelector<HTMLButtonElement>("#toggle-indivisible-help");
    const indivisibleHelpPanel = document.querySelector<HTMLDivElement>("#indivisible-help-panel");
    const indivisibleHelpMeta =
      toggleIndivisibleHelp?.querySelector<HTMLSpanElement>(".accordion-meta");
    const indivisibleHelpForm = document.querySelector<HTMLFormElement>("#indivisible-help-form");
    const indivisibleHelpMessage = document.querySelector<HTMLDivElement>("#indivisible-help-message");
    const indivisibleHelpList = document.querySelector<HTMLDivElement>("#indivisible-help-list");
    const saveMessage = document.querySelector<HTMLDivElement>("#save-message");
    const designationSelect =
      form?.elements.namedItem("eligible_person_designation") as HTMLSelectElement | null;
    const assistanceExtensionField = document.querySelector<HTMLLabelElement>(
      "#assistance-extension-field"
    );
    const assistanceExtensionApproved =
      form?.elements.namedItem("assistance_extension_approved") as HTMLInputElement | null;
    const editAssistanceExtensionField = document.querySelector<HTMLLabelElement>(
      "#edit-assistance-extension-field"
    );
    const editDesignationSelect = document.querySelector<HTMLSelectElement>(
      "#edit-form select[name='eligible_person_designation']"
    );
    const editAssistanceExtensionApproved = document.querySelector<HTMLInputElement>(
      "#edit-form input[name='assistance_extension_approved']"
    );
    const collapsedMetaText = "Kliknij, aby rozwinąć";
    const expandedMetaText = "Kliknij, aby zwinąć";
    const limitedAssistanceDesignations = new Set(["ZWOLNIONA", "NAJBLIZSZA_ZWOLNIONEJ"]);
    const sharedHelpPageSize = 5;
    const peoplePageSize = 20;
    let sharedHelpCurrentPage = 1;
    let peopleCurrentPage = 1;
    const isPublicPage =
      document.querySelector("#login-page") !== null || document.querySelector("#recover-page") !== null;

    if (!isPublicPage) {
      let hasSessionUser = false;
      const rawSessionUser = sessionStorage.getItem(SESSION_USER_KEY);
      if (rawSessionUser) {
        try {
          hasSessionUser = Boolean(JSON.parse(rawSessionUser));
        } catch {
          hasSessionUser = false;
        }
      }
      if (!hasSessionUser) {
        window.location.replace("/login.html");
        return;
      }
    }

    try {
      await ensureAuthorizedPersonsSchemaUpgrades();
    } catch (error) {
      console.error("Nie udało się przygotować struktury tabeli osób uprawnionych:", error);
    }
    try {
      await renderActiveContractBanner();
    } catch (error) {
      console.error("Nie udało się wyświetlić aktywnej umowy:", error);
    }

    function renderMonthlyReminder() {
      const reminder = document.querySelector<HTMLDivElement>("#monthly-reminder");
      if (!reminder) return;
      const now = new Date();
      const dayOfMonth = now.getDate();
      reminder.hidden = !(dayOfMonth >= 5 && dayOfMonth <= 10);
    }
    renderMonthlyReminder();

    function setPersonFormMeta(isOpen: boolean) {
      if (!personFormMeta) return;
      personFormMeta.textContent = isOpen ? expandedMetaText : collapsedMetaText;
    }
    setPersonFormMeta(personPanel?.classList.contains("is-open") ?? false);

    function setupAccordion(
      toggle: HTMLButtonElement | null,
      panel: HTMLDivElement | null,
      meta: HTMLSpanElement | null
    ) {
      const setMeta = (isOpen: boolean) => {
        if (meta) meta.textContent = isOpen ? expandedMetaText : collapsedMetaText;
      };
      setMeta(panel?.classList.contains("is-open") ?? false);
      toggle?.addEventListener("click", () => {
        if (!panel) return;
        const isOpen = panel.classList.contains("is-open");
        if (isOpen) {
          panel.classList.remove("is-open");
          setMeta(false);
          panel.addEventListener(
            "transitionend",
            () => {
              if (!panel.classList.contains("is-open")) {
                panel.hidden = true;
              }
            },
            { once: true }
          );
          return;
        }

        panel.hidden = false;
        panel.classList.add("is-open");
        setMeta(true);
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    function setSaveMessage(text: string, variant: "success" | "error") {
      if (!saveMessage) return;
      saveMessage.textContent = text;
      saveMessage.hidden = false;
      saveMessage.classList.remove("success", "error");
      saveMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    function setOrgMessage(text: string, variant: "success" | "error") {
      if (!orgSaveMessage) return;
      orgSaveMessage.textContent = text;
      orgSaveMessage.hidden = false;
      orgSaveMessage.classList.remove("success", "error");
      orgSaveMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    function getToastHost() {
      let host = document.querySelector<HTMLDivElement>("#app-toast-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "app-toast-host";
        host.className = "app-toast-host";
        document.body.append(host);
      }
      return host;
    }

    function showAppToast(text: string, variant: "info" | "success" | "error" = "info") {
      const host = getToastHost();
      const toast = document.createElement("div");
      toast.className = `app-toast ${variant}`;
      toast.textContent = text;
      host.append(toast);

      requestAnimationFrame(() => {
        toast.classList.add("is-visible");
      });

      window.setTimeout(() => {
        toast.classList.remove("is-visible");
        window.setTimeout(() => toast.remove(), 180);
      }, 3200);
    }

    function showAppConfirm(message: string, options?: { confirmText?: string; cancelText?: string }) {
      return new Promise<boolean>((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "app-dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "app-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = document.createElement("h3");
        title.textContent = "Potwierdzenie";
        const text = document.createElement("p");
        text.textContent = message;

        const actions = document.createElement("div");
        actions.className = "app-dialog-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn ghost";
        cancelButton.textContent = options?.cancelText ?? "Anuluj";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "btn primary";
        confirmButton.textContent = options?.confirmText ?? "Usuń";

        actions.append(cancelButton, confirmButton);
        dialog.append(title, text, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);

        function close(value: boolean) {
          document.removeEventListener("keydown", onKeydown);
          backdrop.remove();
          resolve(value);
        }

        function onKeydown(event: KeyboardEvent) {
          if (event.key === "Escape") {
            close(false);
          }
        }

        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) {
            close(false);
          }
        });
        cancelButton.addEventListener("click", () => close(false));
        confirmButton.addEventListener("click", () => close(true));
        document.addEventListener("keydown", onKeydown);
      });
    }

    function promptArchivePassword(options: { title: string; hint: string }) {
      return new Promise<string | null>((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "app-dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "app-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = document.createElement("h3");
        title.textContent = options.title;
        const hint = document.createElement("p");
        hint.textContent = options.hint;

        const passwordInput = document.createElement("input");
        passwordInput.type = "password";
        passwordInput.className = "dialog-input";
        passwordInput.placeholder = "Podaj hasło";
        passwordInput.autocomplete = "new-password";

        const confirmPasswordInput = document.createElement("input");
        confirmPasswordInput.type = "password";
        confirmPasswordInput.className = "dialog-input";
        confirmPasswordInput.placeholder = "Powtórz hasło";
        confirmPasswordInput.autocomplete = "new-password";

        const validation = document.createElement("div");
        validation.className = "save-message error";
        validation.hidden = true;

        const actions = document.createElement("div");
        actions.className = "app-dialog-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn ghost";
        cancelButton.textContent = "Anuluj";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "btn primary";
        confirmButton.textContent = "Zapisz";

        actions.append(cancelButton, confirmButton);
        dialog.append(title, hint, passwordInput, confirmPasswordInput, validation, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);

        const close = (value: string | null) => {
          document.removeEventListener("keydown", onKeydown);
          backdrop.remove();
          resolve(value);
        };

        const showValidation = (message: string) => {
          validation.textContent = message;
          validation.hidden = false;
        };

        function onKeydown(event: KeyboardEvent) {
          if (event.key === "Escape") {
            close(null);
          } else if (event.key === "Enter") {
            confirmButton.click();
          }
        }

        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) close(null);
        });
        cancelButton.addEventListener("click", () => close(null));
        confirmButton.addEventListener("click", () => {
          const first = passwordInput.value.trim();
          const second = confirmPasswordInput.value.trim();
          if (!first) {
            showValidation("Podaj hasło.");
            return;
          }
          if (first !== second) {
            showValidation("Hasła nie s? takie same.");
            return;
          }
          close(first);
        });

        document.addEventListener("keydown", onKeydown);
        passwordInput.focus();
      });
    }

    function promptContractNumber(options: { title: string; hint: string }) {
      return new Promise<string | null>((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "app-dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "app-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = document.createElement("h3");
        title.textContent = options.title;
        const hint = document.createElement("p");
        hint.textContent = options.hint;

        const contractInput = document.createElement("input");
        contractInput.type = "text";
        contractInput.className = "dialog-input";
        contractInput.placeholder = "Podaj nr umowy";
        contractInput.autocomplete = "off";

        const validation = document.createElement("div");
        validation.className = "save-message error";
        validation.hidden = true;

        const actions = document.createElement("div");
        actions.className = "app-dialog-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn ghost";
        cancelButton.textContent = "Anuluj";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "btn primary";
        confirmButton.textContent = "Zapisz";

        actions.append(cancelButton, confirmButton);
        dialog.append(title, hint, contractInput, validation, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);

        const close = (value: string | null) => {
          document.removeEventListener("keydown", onKeydown);
          backdrop.remove();
          resolve(value);
        };

        const showValidation = (message: string) => {
          validation.textContent = message;
          validation.hidden = false;
        };

        function onKeydown(event: KeyboardEvent) {
          if (event.key === "Escape") {
            close(null);
          } else if (event.key === "Enter") {
            confirmButton.click();
          }
        }

        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) close(null);
        });
        cancelButton.addEventListener("click", () => close(null));
        confirmButton.addEventListener("click", () => {
          const contractNumber = contractInput.value.trim();
          if (!contractNumber) {
            showValidation("Podaj nr umowy.");
            return;
          }
          close(contractNumber);
        });

        document.addEventListener("keydown", onKeydown);
        contractInput.focus();
      });
    }

    function showImportReportDialog(result: ImportDbResult) {
      return new Promise<void>((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "app-dialog-backdrop";

        const dialog = document.createElement("div");
        dialog.className = "app-dialog import-report-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = document.createElement("h3");
        title.textContent = "Raport importu bazy danych";

        const intro = document.createElement("p");
        intro.textContent =
          result.mode === "replace"
            ? "Import zakończony w trybie: Podmień bazę."
            : "Import zakończony w trybie: Dopisz do bazy.";

        const details = document.createElement("div");
        details.className = "import-report-grid";
        const rows: Array<[string, string]> = [
          ["Dodano osób", String(result.imported_persons ?? 0)],
          ["Pominięto duplikaty osób", String(result.skipped_duplicate_persons ?? 0)],
          ["Dodano wpisów pomocy", String(result.imported_help_entries ?? 0)],
          ["Pominięto duplikaty pomocy", String(result.skipped_duplicate_help_entries ?? 0)],
          ["Dodano kont użytkowników", String(result.imported_users ?? 0)],
        ];
        details.innerHTML = rows
          .map(
            ([label, value]) => `
              <div class="import-report-label">${escapeHtml(label)}</div>
              <div class="import-report-value">${escapeHtml(value)}</div>
            `
          )
          .join("");

        const actions = document.createElement("div");
        actions.className = "app-dialog-actions";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "btn primary";
        closeButton.textContent = "Zamknij";

        actions.append(closeButton);
        dialog.append(title, intro, details, actions);
        backdrop.append(dialog);
        document.body.append(backdrop);

        function close() {
          document.removeEventListener("keydown", onKeydown);
          backdrop.remove();
          resolve();
        }

        function onKeydown(event: KeyboardEvent) {
          if (event.key === "Escape" || event.key === "Enter") {
            close();
          }
        }

        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) {
            close();
          }
        });
        closeButton.addEventListener("click", close);
        document.addEventListener("keydown", onKeydown);
        closeButton.focus();
      });
    }

    function syncAssistanceExtensionField() {
      const designation = designationSelect?.value ?? "";
      const shouldShow = limitedAssistanceDesignations.has(designation);
      if (assistanceExtensionField) {
        assistanceExtensionField.hidden = !shouldShow;
      }
      if (!shouldShow && assistanceExtensionApproved) {
        assistanceExtensionApproved.checked = false;
      }
    }
    syncAssistanceExtensionField();
    designationSelect?.addEventListener("change", syncAssistanceExtensionField);

    function syncEditAssistanceExtensionField() {
      const designation = editDesignationSelect?.value ?? "";
      const shouldShow = limitedAssistanceDesignations.has(designation);
      if (editAssistanceExtensionField) {
        editAssistanceExtensionField.hidden = !shouldShow;
      }
      if (!shouldShow && editAssistanceExtensionApproved) {
        editAssistanceExtensionApproved.checked = false;
      }
    }
    syncEditAssistanceExtensionField();
    editDesignationSelect?.addEventListener("change", syncEditAssistanceExtensionField);

    const detailName = document.querySelector<HTMLElement>("#detail-name");
    const detailMeta = document.querySelector<HTMLElement>("#detail-meta");
    const detailPesel = document.querySelector<HTMLElement>("#detail-pesel");
    const detailSupportDeadline = document.querySelector<HTMLElement>("#detail-support-deadline");
    const detailBasic = document.querySelector<HTMLDivElement>("#detail-basic");
    const detailCase = document.querySelector<HTMLDivElement>("#detail-case");
    const editButtons = document.querySelectorAll<HTMLButtonElement>(".edit-person");
    const editForm = document.querySelector<HTMLFormElement>("#edit-form");
    const addHelp = document.querySelector<HTMLButtonElement>("#add-help");
    const helpForm = document.querySelector<HTMLFormElement>("#help-form");
    const helpProviderSelect = helpForm?.elements.namedItem("help_provider") as HTMLSelectElement | null;
    const helpIdInput = helpForm?.elements.namedItem("help_id") as HTMLInputElement | null;
    const helpFormTitle = helpForm?.querySelector<HTMLHeadingElement>(".section-header h2");
    const helpSubmitButton = helpForm?.querySelector<HTMLButtonElement>("button[type='submit']");
    const cancelHelp = document.querySelector<HTMLButtonElement>("#cancel-help");
    const helpTable = document.querySelector<HTMLDivElement>("#help-table");
    const helpTotal = document.querySelector<HTMLSpanElement>("#help-total");
    const helpFilterMode = document.querySelector<HTMLSelectElement>("#help-filter-mode");
    const helpFilterMonthField = document.querySelector<HTMLLabelElement>("#help-filter-month-field");
    const helpFilterMonth = document.querySelector<HTMLInputElement>("#help-filter-month");
    const cancelEdit = document.querySelector<HTMLButtonElement>("#cancel-edit");
    const orgForm = document.querySelector<HTMLFormElement>("#org-form");
    const orgSaveMessage = document.querySelector<HTMLDivElement>("#org-save-message");
    const orgEdit = document.querySelector<HTMLButtonElement>("#org-edit");
    const orgSave = document.querySelector<HTMLButtonElement>("#org-save");
    const orgReadonlyHint = document.querySelector<HTMLParagraphElement>("#org-readonly-hint");
    const contractsList = document.querySelector<HTMLDivElement>("#contracts-list");
    const contractsActiveLabel = document.querySelector<HTMLParagraphElement>("#contracts-active-label");
    const createContractDbButton = document.querySelector<HTMLButtonElement>("#create-contract-db");
    const newContractNumberInput = document.querySelector<HTMLInputElement>("#new-contract-number");
    const contractsMessage = document.querySelector<HTMLDivElement>("#contracts-message");
    const reportsPage = document.querySelector<HTMLElement>("#reports-page");
    const dbImportFile = document.querySelector<HTMLInputElement>("#db-import-file");
    const dbImportMode = document.querySelector<HTMLSelectElement>("#db-import-mode");
    const dbImportButton =
      document.querySelector<HTMLButtonElement>("#importDb") ??
      document.querySelector<HTMLButtonElement>("#db-import-button");
    const dbExportButton =
      document.querySelector<HTMLButtonElement>("#exportDb") ??
      document.querySelector<HTMLButtonElement>("#db-export-button");
    const dbExportEncryptedButton =
      document.querySelector<HTMLButtonElement>("#encryptBackupDb") ??
      document.querySelector<HTMLButtonElement>("#db-export-encrypted-button");
    const dbExportRarButton = document.querySelector<HTMLButtonElement>("#exportDbRar");
    const dbExport7zButton = document.querySelector<HTMLButtonElement>("#exportDb7z");
    const importModeToggle = document.querySelector<HTMLInputElement>("#importModeToggle");
    const importModeValue = document.querySelector<HTMLElement>("#importModeValue");
    const importModeHint = document.querySelector<HTMLElement>("#importModeHint");
    const backupExportMsg = document.querySelector<HTMLDivElement>("#backupExportMsg");
    const backupImportMsg = document.querySelector<HTMLDivElement>("#backupImportMsg");
    const reportDateFrom =
      document.querySelector<HTMLInputElement>("#r_from") ??
      document.querySelector<HTMLInputElement>("#report-date-from");
    const reportDateTo =
      document.querySelector<HTMLInputElement>("#r_to") ??
      document.querySelector<HTMLInputElement>("#report-date-to");
    const reportGenerateButton = document.querySelector<HTMLButtonElement>("#r_generate");
    const reportGenerateAllButton = document.querySelector<HTMLButtonElement>("#r_generate_all");
    const reportFormatSelect = document.querySelector<HTMLSelectElement>("#r_format");
    const reportItems = Array.from(document.querySelectorAll<HTMLInputElement>(".r_item"));
    const reportMessage = document.querySelector<HTMLDivElement>("#r_msg");
    const reportContent = document.querySelector<HTMLDivElement>("#r_content");
    const reportExportCsvButton = document.querySelector<HTMLButtonElement>("#report-export-csv");
    const reportExportExcelButton = document.querySelector<HTMLButtonElement>("#report-export-excel");
    const reportPreview = document.querySelector<HTMLDivElement>("#report-preview");
    const reportSummary = document.querySelector<HTMLDivElement>("#report-summary");
    const summaryEntries = document.querySelector<HTMLSpanElement>("#summary-entries");
    const summaryQuantity = document.querySelector<HTMLSpanElement>("#summary-quantity");
    const summaryAmount = document.querySelector<HTMLSpanElement>("#summary-amount");
    const summaryTotalAmount = document.querySelector<HTMLSpanElement>("#summary-total-amount");
    const loginPage = document.querySelector<HTMLElement>("#login-page");
    const licensePage = document.querySelector<HTMLElement>("#license-page");
    const licenseForm = document.querySelector<HTMLFormElement>("#license-form");
    const licenseMessage = document.querySelector<HTMLDivElement>("#license-message");
    const recoverPage = document.querySelector<HTMLElement>("#recover-page");
    const recoverForm = document.querySelector<HTMLFormElement>("#recover-form");
    const recoverMessage = document.querySelector<HTMLDivElement>("#recover-message");
    const loginForm = document.querySelector<HTMLFormElement>("#login-form");
    const loginExit = document.querySelector<HTMLButtonElement>("#login-exit");
    const loginMessage = document.querySelector<HTMLDivElement>("#login-message");
    const loginHint = document.querySelector<HTMLParagraphElement>("#login-hint");
    const resetPasswordForm = document.querySelector<HTMLFormElement>("#reset-password-form");
    const resetPasswordMessage = document.querySelector<HTMLDivElement>("#reset-password-message");
    const workersPage = document.querySelector<HTMLElement>("#workers-page");
    const workersMessage = document.querySelector<HTMLDivElement>("#workers-message");
    const workersSelfDataMessage = document.querySelector<HTMLDivElement>("#workers-self-data-message");
    const workersSelfMessage = document.querySelector<HTMLDivElement>("#workers-self-message");
    const adminOnly = document.querySelector<HTMLElement>("#admin-only");
    const adminPassword = document.querySelector<HTMLElement>("#admin-password");
    const adminList = document.querySelector<HTMLElement>("#admin-list");
    const workerSelfData = document.querySelector<HTMLElement>("#worker-self-data");
    const workerSelfPassword = document.querySelector<HTMLElement>("#worker-self-password");
    const workerForm = document.querySelector<HTMLFormElement>("#worker-form");
    const workerUserSelect = document.querySelector<HTMLSelectElement>("#worker-user-select");
    const workerReset = document.querySelector<HTMLButtonElement>("#worker-reset");
    const workersList = document.querySelector<HTMLDivElement>("#workers-list");
    const adminPasswordForm = document.querySelector<HTMLFormElement>("#admin-password-form");
    const adminPasswordUser = document.querySelector<HTMLSelectElement>("#admin-password-user");
    const selfDataForm = document.querySelector<HTMLFormElement>("#self-data-form");
    const selfPasswordForm = document.querySelector<HTMLFormElement>("#self-password-form");
    const peselInput = form?.elements.namedItem("pesel") as HTMLInputElement | null;
    const identityDocumentInput = form?.elements.namedItem("identity_document") as HTMLInputElement | null;
    const editPeselInput = editForm?.elements.namedItem("pesel") as HTMLInputElement | null;
    const editIdentityDocumentInput = editForm?.elements.namedItem(
      "identity_document"
    ) as HTMLInputElement | null;
    let activePersonId: number | null = null;
    let activePerson: Person | null = null;
    let currentReport: ReportDataset | null = null;

    attachPeselLiveValidation(peselInput);
    attachPeselLiveValidation(editPeselInput);

    function setupIdentityDocumentMutualLock(
      peselField: HTMLInputElement | null,
      documentField: HTMLInputElement | null
    ) {
      if (!peselField || !documentField) {
        return () => undefined;
      }

      const refresh = () => {
        const hasPesel = peselField.value.trim().length > 0;
        const hasIdentityDocument = documentField.value.trim().length > 0;

        if (hasPesel) {
          peselField.disabled = false;
          documentField.disabled = true;
          return;
        }

        if (hasIdentityDocument) {
          peselField.disabled = true;
          documentField.disabled = false;
          return;
        }

        peselField.disabled = false;
        documentField.disabled = false;
      };

      peselField.addEventListener("input", refresh);
      documentField.addEventListener("input", refresh);
      refresh();
      return refresh;
    }

    setupIdentityDocumentMutualLock(peselInput, identityDocumentInput);
    const refreshEditIdentityLock = setupIdentityDocumentMutualLock(
      editPeselInput,
      editIdentityDocumentInput
    );

    function readSessionUser() {
      const raw = sessionStorage.getItem(SESSION_USER_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AuthUser;
      } catch {
        return null;
      }
    }

    function setSessionUser(user: AuthUser) {
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
      localStorage.removeItem(SESSION_USER_KEY);
    }

    function clearSessionUser() {
      sessionStorage.removeItem(SESSION_USER_KEY);
      localStorage.removeItem(SESSION_USER_KEY);
    }

    function setLicenseMessage(text: string, variant: "success" | "error") {
      if (!licenseMessage) return;
      licenseMessage.textContent = text;
      licenseMessage.hidden = false;
      licenseMessage.classList.remove("success", "error");
      licenseMessage.classList.add(variant);
    }

    function setRecoverMessage(text: string, variant: "success" | "error") {
      if (!recoverMessage) return;
      recoverMessage.textContent = text;
      recoverMessage.hidden = false;
      recoverMessage.classList.remove("success", "error");
      recoverMessage.classList.add(variant);
    }

    function setLoginMessage(text: string, variant: "success" | "error") {
      if (!loginMessage) return;
      loginMessage.textContent = text;
      loginMessage.hidden = false;
      loginMessage.classList.remove("success", "error");
      loginMessage.classList.add(variant);
    }

    function setResetPasswordMessage(text: string, variant: "success" | "error") {
      if (!resetPasswordMessage) return;
      resetPasswordMessage.textContent = text;
      resetPasswordMessage.hidden = false;
      resetPasswordMessage.classList.remove("success", "error");
      resetPasswordMessage.classList.add(variant);
    }

    function getInvokeErrorMessage(error: unknown, fallback: string) {
      if (typeof error === "string" && error.trim()) return error.trim();
      if (error && typeof error === "object") {
        const payload = error as Record<string, unknown>;
        const fields = ["message", "error", "details", "cause"] as const;
        for (const field of fields) {
          const value = payload[field];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
      }
      const asText = String(error ?? "").trim();
      return asText && asText !== "[object Object]" ? asText : fallback;
    }

    function setWorkersMessage(text: string, variant: "success" | "error") {
      const target = adminOnly && !adminOnly.hidden ? workersMessage : workersSelfMessage;
      if (!target) return;
      target.textContent = text;
      target.hidden = false;
      target.classList.remove("success", "error");
      target.classList.add(variant);
      showAppToast(text, variant);
    }

    function setWorkersDataMessage(text: string, variant: "success" | "error") {
      if (!workersSelfDataMessage) {
        setWorkersMessage(text, variant);
        return;
      }
      workersSelfDataMessage.textContent = text;
      workersSelfDataMessage.hidden = false;
      workersSelfDataMessage.classList.remove("success", "error");
      workersSelfDataMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    let loginInitDone = false;
    let loginAllowed = false;

    loginForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        if (!loginForm) return;
        if (!loginInitDone) {
          setLoginMessage("Trwa inicjalizacja logowania, spróbuj ponownie za chwilę.", "error");
          return;
        }
        if (!loginAllowed) {
          setLoginMessage("Logowanie jest obecnie niedostępne. Sprawdź status licencji.", "error");
          return;
        }

        const formData = new FormData(loginForm);
        const username = String(formData.get("username") ?? "").trim();
        const password = String(formData.get("password") ?? "").trim();
        if (!username || !password) {
          setLoginMessage("Podaj login i hasło.", "error");
          return;
        }

        const db = await getDb();
        const users = await db.select<UserRow[]>(
          "SELECT id, username, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1",
          [username]
        );
        const user = users[0];
        if (!user || user.is_active !== 1 || user.password_hash !== password) {
          setLoginMessage("Nieprawidłowy login lub hasło.", "error");
          return;
        }

        setSessionUser({ id: user.id, username: user.username, role: user.role });
        window.location.href = "/index.html";
      })();
    });

    loginExit?.addEventListener("click", async () => {
      try {
        const current = getCurrentWindow();
        await current.close();
      } catch (error) {
        console.error("Nie udało się zamknąć programu:", error);
        setLoginMessage("Nie udało się zamknąć programu.", "error");
      }
    });

    let licenseStatus: LicenseStatus;
    try {
      licenseStatus = await invoke<LicenseStatus>("license_status");
    } catch (error) {
      console.error("Nie udało się sprawdzić statusu licencji:", error);
      if (loginPage) {
        if (loginForm) loginForm.hidden = true;
        if (licensePage) licensePage.hidden = false;
        setLicenseMessage("Nie udało się sprawdzić licencji. Uruchom aplikację ponownie.", "error");
        loginAllowed = false;
        loginInitDone = true;
      } else {
        window.location.href = "/login.html";
      }
      return;
    }

    if (!licenseStatus.activated) {
      clearSessionUser();
      if (loginPage) {
        if (loginForm) loginForm.hidden = true;
        if (licensePage) licensePage.hidden = false;
        licenseForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!licenseForm) return;
          const formData = new FormData(licenseForm);
          const licenseKey = String(formData.get("license_key") ?? "").trim();
          if (!licenseKey) {
            setLicenseMessage("Podaj klucz licencji.", "error");
            return;
          }
          try {
            const contractNumber = await promptContractNumber({
              title: "Nr umowy",
              hint: "Podaj numer umowy, który ma zostać zapisany po aktywacji licencji.",
            });
            if (contractNumber === null) {
              setLicenseMessage("Aktywacja licencji została anulowana.", "error");
              return;
            }
            await invoke("activate_license_key", { licenseKey });
            await ensureOrgTable();
            const db = await getDb();
            await db.execute(
              `INSERT INTO organization_settings (
                id, contract_number, updated_at
              ) VALUES (1, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                contract_number = excluded.contract_number,
                updated_at = datetime('now')`,
              [contractNumber]
            );
            upsertContractRegistryRecord(
              getActiveDbPath(),
              { contract_number: contractNumber },
              true
            );
            setLicenseMessage("Licencja została aktywowana. Trwa przeładowanie...", "success");
            window.location.reload();
          } catch (error) {
            console.error("Błąd aktywacji licencji:", error);
            setLicenseMessage("Nieprawidłowy klucz licencji.", "error");
          }
        });
        loginAllowed = false;
        loginInitDone = true;
      } else {
        window.location.href = "/login.html";
      }
      return;
    }

    await ensureDefaultUsers();
    loginAllowed = true;
    loginInitDone = true;

    const currentUser = readSessionUser();
    if (loginPage) {
      if (currentUser) {
        window.location.href = "/index.html";
        return;
      }

      const resetCode = sessionStorage.getItem(PASSWORD_RESET_CODE_KEY) ?? "";
      const resetNotice = sessionStorage.getItem(PASSWORD_RESET_NOTICE_KEY);
      if (resetNotice) {
        setLoginMessage(resetNotice, "success");
        sessionStorage.removeItem(PASSWORD_RESET_NOTICE_KEY);
      }

      if (resetCode) {
        if (loginForm) loginForm.hidden = true;
        if (resetPasswordForm) resetPasswordForm.hidden = false;
        if (loginHint) {
          loginHint.textContent =
            "W celu resetu hasła wpisz login, nowe hasło i powtórzenie nowego hasła.";
        }

        resetPasswordForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!resetPasswordForm) return;
          const formData = new FormData(resetPasswordForm);
          const username = String(formData.get("username") ?? "").trim();
          const newPassword = String(formData.get("new_password") ?? "").trim();
          const newPasswordRepeat = String(formData.get("new_password_repeat") ?? "").trim();
          if (!username || !newPassword || !newPasswordRepeat) {
            setResetPasswordMessage("Uzupełnij login i oba pola hasła.", "error");
            return;
          }
          if (newPassword !== newPasswordRepeat) {
            setResetPasswordMessage("Nowe hasło i powtórzenie hasła muszą być identyczne.", "error");
            return;
          }
          try {
            await invoke("reset_password_with_recovery_code", {
              username,
              newPassword,
              recoveryCode: resetCode,
              dbPath: getActiveDbPath(),
            });
            sessionStorage.removeItem(PASSWORD_RESET_CODE_KEY);
            sessionStorage.setItem(
              PASSWORD_RESET_NOTICE_KEY,
              "Hasło zostało zmienione. Możesz zalogować się nowym hasłem."
            );
            window.location.href = "/login.html";
          } catch (error) {
            console.error("Błąd resetu hasła:", error);
            setResetPasswordMessage(
              getInvokeErrorMessage(
                error,
                "Nie udało się zresetować hasła. Sprawdź login lub kod resetu."
              ),
              "error"
            );
          }
        });
        return;
      }

      return;
    }

    if (recoverPage) {
      if (currentUser) {
        window.location.href = "/index.html";
        return;
      }
      recoverForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!recoverForm) return;
        const formData = new FormData(recoverForm);
        const recoveryCode = String(formData.get("recovery_code") ?? "").trim();
        if (!recoveryCode) {
          setRecoverMessage("Podaj kod resetu hasła.", "error");
          return;
        }
        try {
          await invoke("verify_recovery_code", { recoveryCode, dbPath: getActiveDbPath() });
          sessionStorage.setItem(PASSWORD_RESET_CODE_KEY, recoveryCode);
          sessionStorage.setItem(
            PASSWORD_RESET_NOTICE_KEY,
            "Kod resetu został potwierdzony. Ustaw nowe hasło."
          );
          window.location.href = "/login.html";
        } catch (error) {
          console.error("Błąd weryfikacji kodu resetu:", error);
          setRecoverMessage(
            getInvokeErrorMessage(error, "Nieprawidłowy kod resetu hasła."),
            "error"
          );
        }
      });
      return;
    }

    if (!currentUser) {
      window.location.href = "/login.html";
      return;
    }

    if (navStaff && currentUser.role !== "Admin") {
      navStaff.textContent = "Moje dane";
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form || !list) return;

      const formData = new FormData(form);
      const designation = String(formData.get("eligible_person_designation") ?? "").trim();
      const isLimitedAssistanceDesignation = limitedAssistanceDesignations.has(designation);
      const isExtensionApproved = Boolean(formData.get("assistance_extension_approved"));
      const noReleaseDateRequiredDesignations = new Set([
        "POZBAWIONA_LUB_ZWALNIANA",
        "NAJBLIZSZA_POZBAWIONEJ",
      ]);
      const requiresReleaseDate = !noReleaseDateRequiredDesignations.has(designation);
      const peselInput = String(formData.get("pesel") ?? "").trim();
      const peselValidation = validatePesel(peselInput);
      const requestDate = String(formData.get("request_date") ?? "").trim();
      const payload = {
        person_uuid: createUuid(),
        request_number: String(formData.get("request_number") ?? "").trim(),
        request_date: requestDate,
        assistance_extension_approved: isExtensionApproved ? 1 : 0,
        eligible_person_designation: designation || null,
        first_name: String(formData.get("first_name") ?? "").trim(),
        last_name: String(formData.get("last_name") ?? "").trim(),
        citizenship: String(formData.get("citizenship") ?? "").trim(),
        pesel: peselValidation.normalized || null,
        birth_date: String(formData.get("birth_date") ?? "").trim(),
        phone: String(formData.get("phone") ?? "").trim(),
        email: String(formData.get("email") ?? "").trim(),
        gender: String(formData.get("gender") ?? "").trim(),
        ukr_status: formData.get("ukr_status") ? 1 : 0,
        address: String(formData.get("address") ?? "").trim(),
        identity_document: String(formData.get("identity_document") ?? "").trim(),
        marital_status: String(formData.get("marital_status") ?? "").trim(),
        disability: String(formData.get("disability") ?? "").trim(),
        funds_on_release: String(formData.get("funds_on_release") ?? "").trim(),
        detention_facility: String(formData.get("detention_facility") ?? "").trim(),
        incarceration_date: String(formData.get("incarceration_date") ?? "").trim(),
        release_date: String(formData.get("release_date") ?? "").trim(),
        info_source: String(formData.get("info_source") ?? "").trim(),
        correspondence_assistance: formData.get("correspondence_assistance") ? 1 : 0,
        assistance_needed: String(formData.get("assistance_needed") ?? "").trim(),
      };

      if (!designation) {
        setSaveMessage("Uzupełnij pole: Oznaczenie osoby uprawnionej.", "error");
        return;
      }

      if (!payload.request_date) {
        setSaveMessage("Uzupełnij pole: Data wniosku.", "error");
        return;
      }

      if (!payload.first_name) {
        setSaveMessage("Uzupełnij pole: Imię.", "error");
        return;
      }

      if (!payload.last_name) {
        setSaveMessage("Uzupełnij pole: Nazwisko.", "error");
        return;
      }

      if (!peselValidation.isValid) {
        setSaveMessage(peselValidation.error ?? "Podano nieprawidłowy numer PESEL.", "error");
        return;
      }

      if (!payload.citizenship) {
        setSaveMessage("Uzupełnij pole: Obywatelstwo.", "error");
        return;
      }

      if (!payload.gender) {
        setSaveMessage("Uzupełnij pole: Płeć.", "error");
        return;
      }

      if (!payload.address) {
        setSaveMessage("Uzupełnij pole: Adres.", "error");
        return;
      }

      if (!payload.marital_status) {
        setSaveMessage("Uzupełnij pole: Stan cywilny.", "error");
        return;
      }

      if (!payload.disability) {
        setSaveMessage("Uzupełnij pole: Niepełnosprawność.", "error");
        return;
      }

      if (!payload.detention_facility) {
        setSaveMessage("Uzupełnij pole: Zakład karny / areszt śledczy.", "error");
        return;
      }

      if (!payload.incarceration_date) {
        setSaveMessage("Uzupełnij pole: Data osadzenia.", "error");
        return;
      }

      if (requiresReleaseDate && !payload.release_date) {
        setSaveMessage("Uzupełnij pole: Data zwolnienia.", "error");
        return;
      }

      const personDateFields: Array<{ label: string; value: string }> = [
        { label: "Data wniosku", value: payload.request_date },
        { label: "Data urodzenia", value: payload.birth_date },
        { label: "Data osadzenia", value: payload.incarceration_date },
        { label: "Data zwolnienia", value: payload.release_date },
      ];
      for (const field of personDateFields) {
        if (!isDateWithinAllowedRange(field.value)) {
          setSaveMessage(
            `${field.label} musi być w zakresie od 01.01.1940 do 31.12.2050.`,
            "error"
          );
          return;
        }
      }

      if (isLimitedAssistanceDesignation) {
        const releaseDate = parseDateInput(payload.release_date);
        if (!releaseDate) {
          setSaveMessage(
            "Dla wybranej osoby podaj datę zwolnienia. Okres pomocy liczony jest od tej daty.",
            "error"
          );
          return;
        }
      }

      try {
        const db = await getDb();
        await db.execute(
          `INSERT INTO authorized_persons (
            person_uuid, request_number, request_date, assistance_extension_approved, first_name, last_name, eligible_person_designation, citizenship, pesel, birth_date, phone, email, gender, ukr_status,
            address, identity_document, marital_status, disability, funds_on_release, detention_facility,
            incarceration_date, release_date, info_source, correspondence_assistance, assistance_needed
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.person_uuid,
            payload.request_number || null,
            payload.request_date || null,
            payload.assistance_extension_approved,
            payload.first_name,
            payload.last_name,
            payload.eligible_person_designation,
            payload.citizenship || null,
            payload.pesel,
            payload.birth_date || null,
            payload.phone || null,
            payload.email || null,
            payload.gender || null,
            payload.ukr_status,
            payload.address || null,
            payload.identity_document || null,
            payload.marital_status || null,
            payload.disability || null,
            payload.funds_on_release ? Number(payload.funds_on_release) : null,
            payload.detention_facility || null,
            payload.incarceration_date || null,
            payload.release_date || null,
            payload.info_source || null,
            payload.correspondence_assistance,
            payload.assistance_needed || null,
          ]
        );

        await loadPersons(list);
        peopleCurrentPage = 1;
        applyPeopleFiltersAndPagination();
        await loadSharedHelpPeople();
        form.reset();
        syncAssistanceExtensionField();
        setSaveMessage(
          "Dane zostały zapisane, w celu dodania informacji na temat udzielonej pomocy proszę wyszukać osobę w Lista osób i uzupełniż dane.",
          "success"
        );
        if (personPanel) {
          personPanel.classList.remove("is-open");
          personPanel.hidden = true;
          setPersonFormMeta(false);
        }
      } catch (error) {
        console.error("Błąd zapisu osoby:", error);
        setSaveMessage(
          "Nie udało się zapisać danych. Sprawdź logi w konsoli (F12) i spróbuj ponownie.",
          "error"
        );
      }
    });

    list?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLDivElement>(".list-row");
      if (!row || row.classList.contains("muted")) return;

      const personUuid = row.dataset.personUuid?.trim();
      if (personUuid) {
        localStorage.setItem(SELECTED_PERSON_UUID_KEY, personUuid);
      } else {
        const id = row.dataset.id;
        if (id) {
          localStorage.setItem("selectedPersonId", id);
        }
      }
      window.location.href = "/detail.html";
    });

    navOrg?.addEventListener("click", () => {
      if (personPanel) {
        personPanel.hidden = false;
        personPanel.classList.add("is-open");
        setPersonFormMeta(true);
        personPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    navStaff?.addEventListener("click", () => {
      window.location.href = "/workers.html";
    });

    navReports?.addEventListener("click", () => {
      window.location.href = "/reports.html";
    });

    navLogout?.addEventListener("click", () => {
      clearSessionUser();
      window.location.href = "/login.html";
    });

    navExit?.addEventListener("click", async () => {
      try {
        const current = getCurrentWindow();
        await current.close();
      } catch (error) {
        console.error("Nie udało się zamknąć programu:", error);
        showAppToast("Nie udało się zamknąć programu.", "error");
      }
    });

    function applyPeopleFiltersAndPagination() {
      if (!list) return;
      const lastNameQuery = (filterLastName?.value ?? "").trim().toLowerCase();
      const peselQuery = (filterPesel?.value ?? "").trim().toLowerCase();
      const result = applyFilters(list, lastNameQuery, peselQuery, {
        page: peopleCurrentPage,
        pageSize: peoplePageSize,
        pageInfo: peoplePageInfo,
        prevButton: peoplePrevPage,
        nextButton: peopleNextPage,
      });
      peopleCurrentPage = result.currentPage;
    }

    filterLastName?.addEventListener("input", () => {
      peopleCurrentPage = 1;
      applyPeopleFiltersAndPagination();
    });

    filterPesel?.addEventListener("input", () => {
      peopleCurrentPage = 1;
      applyPeopleFiltersAndPagination();
    });

    clearFilters?.addEventListener("click", () => {
      if (filterLastName) filterLastName.value = "";
      if (filterPesel) filterPesel.value = "";
      peopleCurrentPage = 1;
      applyPeopleFiltersAndPagination();
    });

    peoplePrevPage?.addEventListener("click", () => {
      peopleCurrentPage = Math.max(1, peopleCurrentPage - 1);
      applyPeopleFiltersAndPagination();
    });

    peopleNextPage?.addEventListener("click", () => {
      peopleCurrentPage += 1;
      applyPeopleFiltersAndPagination();
    });

    setupAccordion(toggleSharedHelp, sharedHelpPanel, sharedHelpMeta ?? null);
    setupAccordion(toggleIndivisibleHelp, indivisibleHelpPanel, indivisibleHelpMeta ?? null);

    sharedHelpForm?.addEventListener("input", updateSharedHelpSummary);
    sharedHelpPeopleList?.addEventListener("change", () => {
      updateSharedHelpSummary();
    });
    sharedHelpFilterName?.addEventListener("input", () => {
      sharedHelpCurrentPage = 1;
      applySharedHelpPeopleFilters();
    });
    sharedHelpFilterPesel?.addEventListener("input", () => {
      sharedHelpCurrentPage = 1;
      applySharedHelpPeopleFilters();
    });
    sharedHelpClearFilters?.addEventListener("click", () => {
      if (sharedHelpFilterName) sharedHelpFilterName.value = "";
      if (sharedHelpFilterPesel) sharedHelpFilterPesel.value = "";
      sharedHelpCurrentPage = 1;
      applySharedHelpPeopleFilters();
    });
    sharedHelpPrevPage?.addEventListener("click", () => {
      sharedHelpCurrentPage = Math.max(1, sharedHelpCurrentPage - 1);
      applySharedHelpPeopleFilters();
    });
    sharedHelpNextPage?.addEventListener("click", () => {
      sharedHelpCurrentPage += 1;
      applySharedHelpPeopleFilters();
    });
    sharedHelpClearSelection?.addEventListener("click", () => {
      sharedHelpPeopleList
        ?.querySelectorAll<HTMLInputElement>("input[name='shared_person_id']")
        .forEach((input) => {
          input.checked = false;
        });
      updateSharedHelpSummary();
    });

    sharedHelpForm?.addEventListener("reset", () => {
      window.setTimeout(() => {
        applySharedHelpPeopleFilters();
        updateSharedHelpSummary();
      }, 0);
    });

    sharedHelpForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!sharedHelpForm) return;

      const formData = new FormData(sharedHelpForm);
      const helpDate = String(formData.get("help_date") ?? "").trim();
      const entryDate = String(formData.get("entry_date") ?? "").trim();
      const helpType = String(formData.get("help_type") ?? "").trim();
      const selectedTypeLabel = sharedHelpTypeSelect?.selectedOptions[0]?.textContent ?? "";
      const helpAmountRaw = String(formData.get("help_amount") ?? "").trim();
      const helpQuantityRaw = String(formData.get("help_quantity") ?? "").trim();
      const amountValue = parseAmount(helpAmountRaw);
      const quantityValue = parseAmount(helpQuantityRaw || "1") || 1;
      const totalAmount = amountValue * quantityValue;
      const selectedPersonIds = getSelectedSharedPersonIds();

      if (!helpType) {
        setSharedHelpMessage("Wybierz rodzaj wsparcia.", "error");
        return;
      }
      if (!helpDate || !entryDate) {
        setSharedHelpMessage("Uzupełnij datę udzielonej pomocy oraz datę wpisu.", "error");
        return;
      }
      if (!isDateWithinAllowedRange(helpDate) || !isDateWithinAllowedRange(entryDate)) {
        setSharedHelpMessage("Daty muszą być w zakresie od 01.01.1940 do 31.12.2050.", "error");
        return;
      }
      if (totalAmount <= 0) {
        setSharedHelpMessage("Podaj kwotę większą od zera.", "error");
        return;
      }
      if (!selectedPersonIds.length) {
        setSharedHelpMessage("Zaznacz co najmniej jedną osobę.", "error");
        return;
      }

      const amountPerPerson = Math.round((totalAmount / selectedPersonIds.length) * 100) / 100;
      const db = await getDb();
      const selectedPersons = await db.select<Person[]>(
        `SELECT id, first_name, last_name, eligible_person_designation, release_date, assistance_extension_approved
         FROM authorized_persons
         WHERE id IN (${selectedPersonIds.map(() => "?").join(",")})`,
        selectedPersonIds
      );
      const invalidPersons = selectedPersons
        .map((person) => {
          const result = validateHelpDateForPerson(helpDate, person);
          if (result.isValid) return null;
          const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || `ID ${person.id}`;
          return `${fullName}: ${result.message}`;
        })
        .filter((value): value is string => Boolean(value));
      if (invalidPersons.length) {
        setSharedHelpMessage(
          `Nie można zapisać pomocy dla wybranej daty. ${invalidPersons.slice(0, 3).join(" ")}`,
          "error"
        );
        return;
      }
      await ensureHelpTable();
      const provider = currentUser.username;
      for (const personId of selectedPersonIds) {
        await db.execute(
          `INSERT INTO person_help_entries (
            event_uuid, person_id, help_date, help_type, help_type_label, help_amount, help_quantity, help_provider, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))`,
          [
            createHelpEventUuid(),
            personId,
            helpDate,
            helpType,
            selectedTypeLabel || null,
            amountPerPerson,
            provider,
            entryDate,
          ]
        );
      }

      sharedHelpForm.reset();
      sharedHelpPeopleList
        ?.querySelectorAll<HTMLInputElement>("input[name='shared_person_id']")
        .forEach((input) => {
          input.checked = false;
        });
      updateSharedHelpSummary();
      setSharedHelpMessage(
        `Dopisano pomoc do ${selectedPersonIds.length} osób. Kwota na osobę: ${formatAmount(amountPerPerson)}.`,
        "success"
      );
    });

    indivisibleHelpForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!indivisibleHelpForm) return;

      const formData = new FormData(indivisibleHelpForm);
      const helpDate = String(formData.get("help_date") ?? "").trim();
      const entryDate = String(formData.get("entry_date") ?? "").trim();
      const helpType = String(formData.get("help_type") ?? "").trim();
      const helpTypeLabel =
        indivisibleHelpForm.querySelector<HTMLSelectElement>("select[name='help_type']")?.selectedOptions[0]
          ?.textContent ?? "";
      const helpAmountRaw = String(formData.get("help_amount") ?? "").trim();
      const helpQuantityRaw = String(formData.get("help_quantity") ?? "").trim();
      const reason = String(formData.get("reason") ?? "").trim();
      const amountValue = parseAmount(helpAmountRaw);
      const quantityValue = parseAmount(helpQuantityRaw || "1") || 1;

      if (!helpType) {
        setIndivisibleHelpMessage("Wpisz rodzaj wsparcia.", "error");
        return;
      }
      if (!helpDate || !entryDate) {
        setIndivisibleHelpMessage("Uzupełnij datę udzielonej pomocy oraz datę wpisu.", "error");
        return;
      }
      if (!isDateWithinAllowedRange(helpDate) || !isDateWithinAllowedRange(entryDate)) {
        setIndivisibleHelpMessage("Daty muszą być w zakresie od 01.01.1940 do 31.12.2050.", "error");
        return;
      }
      if (amountValue * quantityValue <= 0) {
        setIndivisibleHelpMessage("Podaj kwotę większą od zera.", "error");
        return;
      }
      if (!reason) {
        setIndivisibleHelpMessage("Opisz, dlaczego pomoc nie może zostać podzielona.", "error");
        return;
      }

      await ensureIndivisibleHelpTable();
      const db = await getDb();
      await db.execute(
        `INSERT INTO indivisible_help_entries (
          entry_uuid, help_date, entry_date, help_type, help_type_label, help_amount, help_quantity, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          createUuid(),
          helpDate,
          entryDate,
          helpType,
          helpTypeLabel || null,
          amountValue,
          quantityValue,
          reason,
        ]
      );

      indivisibleHelpForm.reset();
      await loadIndivisibleHelpEntries();
      setIndivisibleHelpMessage("Zapisano wpis pomocy niepodzielnej.", "success");
    });

    togglePersonForm?.addEventListener("click", () => {
      if (!personPanel) return;
      const isOpen = personPanel.classList.contains("is-open");
      if (isOpen) {
        personPanel.classList.remove("is-open");
        setPersonFormMeta(false);
        personPanel.addEventListener(
          "transitionend",
          () => {
            if (!personPanel.classList.contains("is-open")) {
              personPanel.hidden = true;
            }
          },
          { once: true }
        );
      } else {
        personPanel.hidden = false;
        personPanel.classList.add("is-open");
        setPersonFormMeta(true);
        personPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    if (list) {
      try {
        await loadPersons(list);
        applyPeopleFiltersAndPagination();
        await loadSharedHelpPeople();
        await loadIndivisibleHelpEntries();
      } catch (error) {
        console.error("Nie udało się wczytać listy osób:", error);
      }
    }

    if (detailName && detailBasic && detailCase) {
      const rawUuid = localStorage.getItem(SELECTED_PERSON_UUID_KEY);
      const rawId = localStorage.getItem("selectedPersonId");
      if (!rawUuid && !rawId) {
        detailName.textContent = "Brak danych osoby";
        if (detailMeta) detailMeta.textContent = "Wróć do listy i wybierz osobę.";
        if (detailPesel) detailPesel.textContent = "";
        if (detailSupportDeadline) detailSupportDeadline.textContent = "";
        return;
      }

      const db = await getDb();
      const result = rawUuid
        ? await db.select<Person[]>("SELECT * FROM authorized_persons WHERE person_uuid = ? LIMIT 1", [rawUuid])
        : await db.select<Person[]>("SELECT * FROM authorized_persons WHERE id = ? LIMIT 1", [Number(rawId)]);
      const person = result[0];
      if (!person) {
        detailName.textContent = "Brak danych osoby";
        if (detailMeta) detailMeta.textContent = "Wróć do listy i wybierz osobę.";
        if (detailPesel) detailPesel.textContent = "";
        if (detailSupportDeadline) detailSupportDeadline.textContent = "";
        return;
      }

      if (person.person_uuid) {
        localStorage.setItem(SELECTED_PERSON_UUID_KEY, person.person_uuid);
      }
      activePersonId = person.id;
      activePerson = person;
      try {
        await loadHelpEntries(person.id);
      } catch (error) {
        console.error("Nie udało się wczytać wpisów pomocy:", error);
      }

      renderDetail(
        person,
        detailName,
        detailMeta,
        detailPesel,
        detailSupportDeadline,
        detailBasic,
        detailCase
      );
      if (editForm) {
        fillEditForm(editForm, person);
        syncEditAssistanceExtensionField();
        refreshEditIdentityLock();
      }

      editButtons.forEach((button) => {
        button.addEventListener("click", () => {
          if (editForm) editForm.hidden = false;
          editForm?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      cancelEdit?.addEventListener("click", () => {
        if (editForm) editForm.hidden = true;
      });

      editForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!editForm) return;
        const formData = new FormData(editForm);
        const peselInput = String(formData.get("pesel") ?? "").trim();
        const peselValidation = validatePesel(peselInput);

        const updated: Person = {
          ...person,
          request_number: String(formData.get("request_number") ?? "").trim(),
          request_date: String(formData.get("request_date") ?? "").trim(),
          assistance_extension_approved: formData.get("assistance_extension_approved") ? 1 : 0,
          eligible_person_designation: String(
            formData.get("eligible_person_designation") ?? ""
          ).trim(),
          first_name: String(formData.get("first_name") ?? "").trim(),
          last_name: String(formData.get("last_name") ?? "").trim(),
          citizenship: String(formData.get("citizenship") ?? "").trim(),
          pesel: peselValidation.normalized || undefined,
          birth_date: String(formData.get("birth_date") ?? "").trim(),
          phone: String(formData.get("phone") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          gender: String(formData.get("gender") ?? "").trim(),
          ukr_status: formData.get("ukr_status") ? 1 : 0,
          address: String(formData.get("address") ?? "").trim(),
          identity_document: String(formData.get("identity_document") ?? "").trim(),
          marital_status: String(formData.get("marital_status") ?? "").trim(),
          disability: String(formData.get("disability") ?? "").trim(),
          funds_on_release: Number(String(formData.get("funds_on_release") ?? "0")) || undefined,
          detention_facility: String(formData.get("detention_facility") ?? "").trim(),
          incarceration_date: String(formData.get("incarceration_date") ?? "").trim(),
          release_date: String(formData.get("release_date") ?? "").trim(),
          info_source: String(formData.get("info_source") ?? "").trim(),
          correspondence_assistance: formData.get("correspondence_assistance") ? 1 : 0,
          assistance_needed: String(formData.get("assistance_needed") ?? "").trim(),
        };

        if (!peselValidation.isValid) {
          showAppToast(peselValidation.error ?? "Podano nieprawidłowy numer PESEL.", "error");
          return;
        }
        if (!updated.request_date) {
          showAppToast("Uzupełnij pole: Data wniosku.", "error");
          return;
        }

        const editDateFields: Array<{ label: string; value: string }> = [
          { label: "Data wniosku", value: updated.request_date ?? "" },
          { label: "Data urodzenia", value: updated.birth_date ?? "" },
          { label: "Data osadzenia", value: updated.incarceration_date ?? "" },
          { label: "Data zwolnienia", value: updated.release_date ?? "" },
        ];
        for (const field of editDateFields) {
          if (!isDateWithinAllowedRange(field.value)) {
            showAppToast(
              `${field.label} musi być w zakresie od 01.01.1940 do 31.12.2050.`,
              "error"
            );
            return;
          }
        }

        try {
          const db = await getDb();
          const updateWhereColumn = updated.person_uuid ? "person_uuid" : "id";
          const updateWhereValue = updated.person_uuid || updated.id;
          await db.execute(
            `UPDATE authorized_persons SET
              request_number = ?, request_date = ?, assistance_extension_approved = ?, eligible_person_designation = ?, first_name = ?, last_name = ?, citizenship = ?, pesel = ?, birth_date = ?, phone = ?,
              email = ?, gender = ?, ukr_status = ?, address = ?, identity_document = ?, marital_status = ?,
              disability = ?, funds_on_release = ?, detention_facility = ?, incarceration_date = ?, release_date = ?,
              info_source = ?, correspondence_assistance = ?, assistance_needed = ?
            WHERE ${updateWhereColumn} = ?`,
            [
              updated.request_number || null,
              updated.request_date || null,
              updated.assistance_extension_approved ?? 0,
              updated.eligible_person_designation || null,
              updated.first_name,
              updated.last_name,
              updated.citizenship || null,
              updated.pesel || null,
              updated.birth_date || null,
              updated.phone || null,
              updated.email || null,
              updated.gender || null,
              updated.ukr_status ?? 0,
              updated.address || null,
              updated.identity_document || null,
              updated.marital_status || null,
              updated.disability || null,
              updated.funds_on_release ?? null,
              updated.detention_facility || null,
              updated.incarceration_date || null,
              updated.release_date || null,
              updated.info_source || null,
              updated.correspondence_assistance ?? 0,
              updated.assistance_needed || null,
              updateWhereValue,
            ]
          );

          const refreshedRows = updated.person_uuid
            ? await db.select<Person[]>("SELECT * FROM authorized_persons WHERE person_uuid = ? LIMIT 1", [
                updated.person_uuid,
              ])
            : await db.select<Person[]>("SELECT * FROM authorized_persons WHERE id = ? LIMIT 1", [updated.id]);
          const refreshed = refreshedRows[0] ?? updated;
          renderDetail(
            refreshed,
            detailName,
            detailMeta,
            detailPesel,
            detailSupportDeadline,
            detailBasic,
            detailCase
          );
          activePerson = refreshed;
          fillEditForm(editForm, refreshed);
          syncEditAssistanceExtensionField();
          refreshEditIdentityLock();
          editForm.hidden = true;
          showAppToast("Dane osoby zostały zapisane.", "success");
        } catch (error) {
          console.error("Błąd zapisu zmian osoby:", error);
          showAppToast("Nie udało się zapisać zmian osoby.", "error");
        }
      });
    }

    function parseAmount(value: string) {
      const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
      const amount = Number(normalized);
      return Number.isFinite(amount) ? amount : 0;
    }

    function formatAmount(value: number) {
      return `${value.toFixed(2).replace(".", ",")} zł`;
    }

    function populateHelpTypeSelect(select: HTMLSelectElement | null) {
      if (!select) return;
      const currentValue = select.value;
      select.innerHTML = '<option value="">Wybierz</option>';
      HELP_TYPE_OPTIONS.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      });
      select.value = currentValue;
    }

    document
      .querySelectorAll<HTMLSelectElement>("select[name='help_type'], #shared-help-type")
      .forEach(populateHelpTypeSelect);

    function setHelpFormMode(mode: "create" | "edit") {
      if (helpFormTitle) {
        helpFormTitle.textContent = mode === "edit" ? "Edytuj wpis pomocy" : "Dodaj wpis pomocy";
      }
      if (helpSubmitButton) {
        helpSubmitButton.textContent = mode === "edit" ? "Zapisz wpis" : "Dodaj wpis";
      }
    }

    function formatWorkerFullName(user: UserRow) {
      const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
      return fullName || user.username;
    }

    async function loadHelpProviders(selectedProvider = "") {
      if (!helpProviderSelect) return;
      const db = await getDb();
      const users = await db.select<UserRow[]>(
        "SELECT id, username, password_hash, role, is_active, first_name, last_name, position FROM users ORDER BY last_name COLLATE NOCASE ASC, first_name COLLATE NOCASE ASC, username COLLATE NOCASE ASC"
      );
      const providerNames = Array.from(new Set(users.map((user) => formatWorkerFullName(user))));
      const options = ['<option value="">Wybierz</option>'];
      providerNames.forEach((name) => {
        options.push(`<option value="${name}">${name}</option>`);
      });
      if (selectedProvider && !providerNames.includes(selectedProvider)) {
        options.push(`<option value="${selectedProvider}">${selectedProvider}</option>`);
      }
      helpProviderSelect.innerHTML = options.join("");
      helpProviderSelect.value = selectedProvider;
    }

    function setSharedHelpMessage(text: string, variant: "success" | "error") {
      if (!sharedHelpMessage) return;
      sharedHelpMessage.textContent = text;
      sharedHelpMessage.hidden = false;
      sharedHelpMessage.classList.remove("success", "error");
      sharedHelpMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    function setIndivisibleHelpMessage(text: string, variant: "success" | "error") {
      if (!indivisibleHelpMessage) return;
      indivisibleHelpMessage.textContent = text;
      indivisibleHelpMessage.hidden = false;
      indivisibleHelpMessage.classList.remove("success", "error");
      indivisibleHelpMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    async function loadSharedHelpPeople() {
      if (!sharedHelpPeopleList) return;
      const db = await getDb();
      const persons = await db.select<Person[]>(
        "SELECT id, person_uuid, first_name, last_name, pesel FROM authorized_persons ORDER BY last_name COLLATE NOCASE ASC, first_name COLLATE NOCASE ASC"
      );
      sharedHelpPeopleList.innerHTML = "";
      if (!persons.length) {
        sharedHelpPeopleList.innerHTML = `<div class="shared-person-row muted">Brak zapisanych osób</div>`;
        updateSharedHelpSummary();
        return;
      }
      persons.forEach((person) => {
        const label = document.createElement("label");
        label.className = "shared-person-row";
        const fullName = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Bez imienia";
        label.dataset.fullName = fullName;
        label.dataset.pesel = person.pesel ?? "";
        label.innerHTML = `
          <input type="checkbox" name="shared_person_id" value="${person.id}" />
          <span>${escapeHtml(fullName)}</span>
          <span>${escapeHtml(person.pesel ?? "-")}</span>
        `;
        sharedHelpPeopleList.append(label);
      });
      applySharedHelpPeopleFilters();
      updateSharedHelpSummary();
    }

    function getSelectedSharedPersonIds() {
      if (!sharedHelpPeopleList) return [];
      return Array.from(
        sharedHelpPeopleList.querySelectorAll<HTMLInputElement>("input[name='shared_person_id']:checked")
      )
        .map((input) => Number(input.value))
        .filter((value) => Number.isFinite(value) && value > 0);
    }

    function applySharedHelpPeopleFilters() {
      if (!sharedHelpPeopleList) return;
      const nameQuery = (sharedHelpFilterName?.value ?? "").trim().toLowerCase();
      const peselQuery = (sharedHelpFilterPesel?.value ?? "").trim().toLowerCase();
      const matchingRows: HTMLLabelElement[] = [];

      sharedHelpPeopleList.querySelectorAll<HTMLLabelElement>(".shared-person-row").forEach((row) => {
        if (row.classList.contains("muted")) return;
        const fullName = (row.dataset.fullName ?? "").toLowerCase();
        const pesel = (row.dataset.pesel ?? "").toLowerCase();
        const matchesName = !nameQuery || fullName.includes(nameQuery);
        const matchesPesel = !peselQuery || pesel.includes(peselQuery);
        if (matchesName && matchesPesel) {
          matchingRows.push(row);
        }
        row.hidden = true;
      });

      let emptyRow = sharedHelpPeopleList.querySelector<HTMLDivElement>("#shared-help-no-results");
      if (matchingRows.length === 0 && (nameQuery || peselQuery)) {
        if (!emptyRow) {
          emptyRow = document.createElement("div");
          emptyRow.id = "shared-help-no-results";
          emptyRow.className = "shared-person-row muted";
          emptyRow.textContent = "Brak wyników dla podanych filtrów";
          sharedHelpPeopleList.append(emptyRow);
        }
      } else if (emptyRow) {
        emptyRow.remove();
      }

      const totalPages = Math.max(1, Math.ceil(matchingRows.length / sharedHelpPageSize));
      sharedHelpCurrentPage = Math.min(Math.max(1, sharedHelpCurrentPage), totalPages);
      const startIndex = (sharedHelpCurrentPage - 1) * sharedHelpPageSize;
      matchingRows.slice(startIndex, startIndex + sharedHelpPageSize).forEach((row) => {
        row.hidden = false;
      });
      if (sharedHelpPageInfo) {
        sharedHelpPageInfo.textContent = matchingRows.length
          ? `Strona ${sharedHelpCurrentPage} z ${totalPages}`
          : "Strona 0 z 0";
      }
      if (sharedHelpPrevPage) {
        sharedHelpPrevPage.disabled = sharedHelpCurrentPage <= 1 || matchingRows.length === 0;
      }
      if (sharedHelpNextPage) {
        sharedHelpNextPage.disabled = sharedHelpCurrentPage >= totalPages || matchingRows.length === 0;
      }
    }

    function updateSharedHelpSummary() {
      if (!sharedHelpForm || !sharedHelpSummary) return;
      const amount = parseAmount(
        String((sharedHelpForm.elements.namedItem("help_amount") as HTMLInputElement | null)?.value ?? "")
      );
      const quantity =
        parseAmount(
          String((sharedHelpForm.elements.namedItem("help_quantity") as HTMLInputElement | null)?.value ?? "1")
        ) || 1;
      const totalAmount = amount * quantity;
      const selectedCount = getSelectedSharedPersonIds().length;
      const amountPerPerson = selectedCount > 0 ? totalAmount / selectedCount : 0;
      const summaryTotal = sharedHelpSummary.querySelector<HTMLElement>("[data-summary='total']");
      const summaryPeople = sharedHelpSummary.querySelector<HTMLElement>("[data-summary='people']");
      const summaryPerPerson = sharedHelpSummary.querySelector<HTMLElement>("[data-summary='per-person']");
      if (summaryTotal) summaryTotal.textContent = formatAmount(totalAmount);
      if (summaryPeople) summaryPeople.textContent = String(selectedCount);
      if (summaryPerPerson) summaryPerPerson.textContent = selectedCount ? formatAmount(amountPerPerson) : "-";
      if (sharedHelpSelectedCount) {
        sharedHelpSelectedCount.textContent = `Zaznaczono: ${selectedCount}`;
      }
    }

    async function loadIndivisibleHelpEntries() {
      if (!indivisibleHelpList) return;
      await ensureIndivisibleHelpTable();
      const db = await getDb();
      const entries = await db.select<
        Array<{
          id: number;
          help_date?: string;
          entry_date?: string;
          help_type?: string;
          help_type_label?: string;
          help_amount?: number;
          help_quantity?: number;
          reason?: string;
        }>
      >(
        `SELECT id, help_date, entry_date, help_type, help_type_label, help_amount, help_quantity, reason
         FROM indivisible_help_entries
         ORDER BY COALESCE(entry_date, help_date, created_at) DESC, id DESC
         LIMIT 20`
      );
      if (!entries.length) {
        indivisibleHelpList.innerHTML = `<div class="indivisible-help-row muted"><span>Brak wpisów</span><span>-</span><span>-</span><span>-</span></div>`;
        return;
      }
      indivisibleHelpList.innerHTML = entries
        .map((entry) => {
          const amount = Number(entry.help_amount ?? 0);
          const quantity = Number(entry.help_quantity ?? 1);
          return `
            <div class="indivisible-help-row">
              <span>${escapeHtml(entry.help_date || entry.entry_date || "-")}</span>
              <span>${escapeHtml(entry.help_type_label || entry.help_type || "-")}</span>
              <span>${formatAmount(amount * quantity)}</span>
              <span>${escapeHtml(entry.reason || "-")}</span>
            </div>
          `;
        })
        .join("");
    }

    function resetHelpForm() {
      if (!helpForm) return;
      helpForm.reset();
      if (helpIdInput) helpIdInput.value = "";
      setHelpFormMode("create");
    }

    function createEmptyHelpRow() {
      const row = document.createElement("div");
      row.className = "table-row muted";
      row.innerHTML = `
        <span>Brak wpisów</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
        <span>-</span>
      `;
      return row;
    }

    function createHelpRow(entry: HelpEntry) {
      const row = document.createElement("div");
      row.className = "table-row";
      row.dataset.helpId = String(entry.id);
      row.dataset.helpDate = entry.help_date ?? "";
      row.dataset.helpType = entry.help_type ?? "";
      row.dataset.helpAmount = entry.help_amount?.toString() ?? "";
      row.dataset.helpQuantity = entry.help_quantity?.toString() ?? "1";
      row.dataset.helpProvider = entry.help_provider ?? "";

      const amount = Number(entry.help_amount ?? 0);
      const quantity = Number(entry.help_quantity ?? 1);
      const sumValue = amount * quantity;
      row.dataset.sumValue = sumValue.toString();

      const values = [
        entry.help_date || "-",
        entry.help_type_label || "-",
        entry.help_amount != null ? formatAmount(amount) : "-",
        entry.help_quantity != null ? String(quantity) : "-",
        sumValue ? formatAmount(sumValue) : "-",
        entry.help_provider || "-",
      ];

      values.forEach((value) => {
        const cell = document.createElement("span");
        cell.textContent = value;
        row.append(cell);
      });

      const actions = document.createElement("span");
      actions.className = "help-actions";
      const editHelpButton = document.createElement("button");
      editHelpButton.type = "button";
      editHelpButton.className = "btn ghost edit-help";
      editHelpButton.textContent = "Edytuj";
      const deleteHelpButton = document.createElement("button");
      deleteHelpButton.type = "button";
      deleteHelpButton.className = "btn ghost delete-help";
      deleteHelpButton.textContent = "Usuń";
      actions.append(editHelpButton);
      actions.append(deleteHelpButton);
      row.append(actions);
      return row;
    }

    function updateHelpTotal() {
      if (!helpTable || !helpTotal) return;
      const rows = helpTable.querySelectorAll<HTMLDivElement>(".table-row");
      let total = 0;
      rows.forEach((row) => {
        if (row.classList.contains("muted")) return;
        total += Number(row.dataset.sumValue ?? 0);
      });
      helpTotal.textContent = `${total.toFixed(2).replace(".", ",")} zł`;
    }

    function currentMonthValue() {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      return `${now.getFullYear()}-${month}`;
    }

    function syncHelpFilterUi() {
      const mode = helpFilterMode?.value ?? "all";
      if (helpFilterMonthField) {
        helpFilterMonthField.hidden = mode !== "month";
      }
      if (mode === "month" && helpFilterMonth && !helpFilterMonth.value) {
        helpFilterMonth.value = currentMonthValue();
      }
    }

    function getHelpFilterState() {
      const mode = helpFilterMode?.value === "month" ? "month" : "all";
      const month = (helpFilterMonth?.value ?? "").trim();
      return { mode, month };
    }

    syncHelpFilterUi();
    helpFilterMode?.addEventListener("change", () => {
      syncHelpFilterUi();
      if (activePersonId) {
        void loadHelpEntries(activePersonId);
      }
    });
    helpFilterMonth?.addEventListener("change", () => {
      if (activePersonId && (helpFilterMode?.value ?? "all") === "month") {
        void loadHelpEntries(activePersonId);
      }
    });

    async function loadHelpEntries(personId: number) {
      if (!helpTable) return;
      await ensureHelpTable();
      const db = await getDb();
      const filter = getHelpFilterState();
      const whereClauses = ["person_id = ?"];
      const params: Array<number | string> = [personId];
      if (filter.mode === "month" && filter.month) {
        whereClauses.push("substr(COALESCE(help_date, ''), 1, 7) = ?");
        params.push(filter.month);
      }
      const entries = await db.select<HelpEntry[]>(
        `SELECT id, event_uuid, person_id, help_date, help_type, help_type_label, help_amount, help_quantity, help_provider
         FROM person_help_entries
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY help_date DESC, id DESC`,
        params
      );

      helpTable.innerHTML = "";
      if (!entries.length) {
        helpTable.append(createEmptyHelpRow());
      } else {
        entries.forEach((entry) => {
          helpTable.append(createHelpRow(entry));
        });
      }
      updateHelpTotal();
    }

    addHelp?.addEventListener("click", () => {
      void (async () => {
        if (!helpForm) return;
        await loadHelpProviders();
        resetHelpForm();
        helpForm.hidden = false;
        helpForm.scrollIntoView({ behavior: "smooth", block: "start" });
      })();
    });

    cancelHelp?.addEventListener("click", () => {
      if (!helpForm) return;
      helpForm.hidden = true;
      resetHelpForm();
    });

    helpTable?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const deleteButton = target.closest<HTMLButtonElement>(".delete-help");
      if (deleteButton) {
        if (!activePersonId) return;
        const row = deleteButton.closest<HTMLDivElement>(".table-row");
        if (!row) return;
        const helpId = Number(row.dataset.helpId ?? 0);
        if (!helpId) return;

        void (async () => {
          const accepted = await showAppConfirm("Czy na pewno chcesz usunąć ten wpis pomocy?");
          if (!accepted) return;
          const db = await getDb();
          await db.execute("DELETE FROM person_help_entries WHERE id = ? AND person_id = ?", [
            helpId,
            activePersonId,
          ]);
          await loadHelpEntries(activePersonId);
          showAppToast("Wpis pomocy został usuniżty.", "success");
        })();
        return;
      }

      const editButton = target.closest<HTMLButtonElement>(".edit-help");
      if (!editButton || !helpForm) return;

      const row = editButton.closest<HTMLDivElement>(".table-row");
      if (!row) return;

      if (helpIdInput) helpIdInput.value = row.dataset.helpId ?? "";
      (helpForm.elements.namedItem("help_date") as HTMLInputElement).value = row.dataset.helpDate ?? "";
      (helpForm.elements.namedItem("help_type") as HTMLSelectElement).value = row.dataset.helpType ?? "";
      (helpForm.elements.namedItem("help_amount") as HTMLInputElement).value =
        row.dataset.helpAmount ?? "";
      (helpForm.elements.namedItem("help_quantity") as HTMLInputElement).value =
        row.dataset.helpQuantity ?? "1";
      void (async () => {
        await loadHelpProviders(row.dataset.helpProvider ?? "");
        (helpForm.elements.namedItem("help_provider") as HTMLSelectElement).value =
          row.dataset.helpProvider ?? "";

        setHelpFormMode("edit");
        helpForm.hidden = false;
        helpForm.scrollIntoView({ behavior: "smooth", block: "start" });
      })();
    });

    helpForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!helpForm || !activePersonId) return;

      const formData = new FormData(helpForm);
      const helpIdRaw = String(formData.get("help_id") ?? "").trim();
      const helpDate = String(formData.get("help_date") ?? "").trim();
      const helpType = String(formData.get("help_type") ?? "").trim();
      const helpAmount = String(formData.get("help_amount") ?? "").trim();
      const helpQuantity = String(formData.get("help_quantity") ?? "").trim();
      const helpProvider = String(formData.get("help_provider") ?? "").trim();
      const helpTypeLabel =
        helpForm.querySelector<HTMLSelectElement>("select[name='help_type']")?.selectedOptions[0]
          ?.textContent ?? "";

      const amountValue = parseAmount(helpAmount);
      const quantityValue = parseAmount(helpQuantity || "1") || 1;
      const db = await getDb();

      if (!isDateWithinAllowedRange(helpDate)) {
        showAppToast("Data udzielonej pomocy musi być w zakresie od 01.01.1940 do 31.12.2050.", "error");
        return;
      }

      if (activePerson) {
        const supportValidation = validateHelpDateForPerson(helpDate, activePerson);
        if (!supportValidation.isValid) {
          showAppToast(supportValidation.message ?? "Data udzielonej pomocy jest poza okresem uprawnienia.", "error");
          return;
        }
      }

      if (helpIdRaw) {
        await db.execute(
          `UPDATE person_help_entries
           SET help_date = ?, help_type = ?, help_type_label = ?, help_amount = ?, help_quantity = ?,
               help_provider = ?, updated_at = datetime('now')
           WHERE id = ? AND person_id = ?`,
          [
            helpDate || null,
            helpType || null,
            helpTypeLabel || null,
            helpAmount ? amountValue : null,
            quantityValue,
            helpProvider || null,
            Number(helpIdRaw),
            activePersonId,
          ]
        );
      } else {
        await db.execute(
          `INSERT INTO person_help_entries (
            event_uuid, person_id, help_date, help_type, help_type_label, help_amount, help_quantity, help_provider, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            createHelpEventUuid(),
            activePersonId,
            helpDate || null,
            helpType || null,
            helpTypeLabel || null,
            helpAmount ? amountValue : null,
            quantityValue,
            helpProvider || null,
          ]
        );
      }

      await loadHelpEntries(activePersonId);
      helpForm.hidden = true;
      resetHelpForm();
      showAppToast(helpIdRaw ? "Zapisano zmiany wpisu pomocy." : "Dodano wpis pomocy.", "success");
    });

    function formatNumber(value: number) {
      return value.toFixed(2).replace(".", ",");
    }

    function escapeCsvCell(value: string) {
      const escaped = value.replace(/"/g, "\"\"");
      return `"${escaped}"`;
    }

    function sanitizeFileNamePart(value: string) {
      return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    }

    function getPreviousMonthDescriptor() {
      const monthNames = [
        "STYCZEN",
        "LUTY",
        "MARZEC",
        "KWIECIEN",
        "MAJ",
        "CZERWIEC",
        "LIPIEC",
        "SIERPIEN",
        "WRZESIEN",
        "PAZDZIERNIK",
        "LISTOPAD",
        "GRUDZIEN",
      ];
      const now = new Date();
      const previousMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
      return {
        monthLabel: monthNames[previousMonthDate.getMonth()],
        yearLabel: String(previousMonthDate.getFullYear()),
      };
    }

    async function buildReportsFileBaseName() {
      await ensureOrgTable();
      const db = await getDb();
      const orgRows = await db.select<OrgSettings[]>(
        "SELECT contract_number FROM organization_settings WHERE id = 1 LIMIT 1"
      );
      const contractNumber = sanitizeFileNamePart(orgRows[0]?.contract_number?.trim() || "BRAK_UMOWY");
      const { monthLabel, yearLabel } = getPreviousMonthDescriptor();
      return `${contractNumber}_WYKAZ_OSOB_${monthLabel}_${yearLabel}`;
    }

    async function buildDatabaseFileBaseName() {
      await ensureOrgTable();
      const db = await getDb();
      const orgRows = await db.select<OrgSettings[]>(
        "SELECT contract_number FROM organization_settings WHERE id = 1 LIMIT 1"
      );
      const contractNumber = sanitizeFileNamePart(orgRows[0]?.contract_number?.trim() || "BRAK_UMOWY");
      const { monthLabel, yearLabel } = getPreviousMonthDescriptor();
      return `${contractNumber}_BAZA_DANYCH_${monthLabel}_${yearLabel}`;
    }

    function toBase64(bytes: Uint8Array) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      return btoa(binary);
    }

    function buildHelpDateFilter(fromDate: string, toDate: string, alias = "he") {
      const clauses: string[] = [];
      const params: string[] = [];
      if (fromDate) {
        clauses.push(`DATE(${alias}.help_date) >= DATE(?)`);
        params.push(fromDate);
      }
      if (toDate) {
        clauses.push(`DATE(${alias}.help_date) <= DATE(?)`);
        params.push(toDate);
      }
      return {
        whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
        params,
      };
    }

    function renderReportPreview(report: ReportDataset | null) {
      if (!reportPreview) return;
      if (!report) {
        reportPreview.innerHTML = `
          <div class="table-row muted">
            <span>Wygeneruj raport, aby zobaczyć podgląd</span>
          </div>
        `;
        return;
      }

      const headerCells = report.headers.map((header) => `<th>${header}</th>`).join("");
      const bodyRows = report.rows.length
        ? report.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
            .join("")
        : `<tr><td colspan="${report.headers.length}">Brak danych dla wybranego zakresu.</td></tr>`;

      reportPreview.innerHTML = `
        <div class="report-preview-title">${report.title}</div>
        <div class="report-preview-wrap">
          <table class="report-preview-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      `;
    }

    function renderReportSummary(summary: ReportSummary | null) {
      if (!reportSummary) return;
      if (!summary) {
        reportSummary.hidden = true;
        return;
      }
      if (summaryEntries) summaryEntries.textContent = String(summary.entriesCount);
      if (summaryQuantity) summaryQuantity.textContent = formatNumber(summary.totalQuantity);
      if (summaryAmount) summaryAmount.textContent = `${formatNumber(summary.totalAmount)} PLN`;
      if (summaryTotalAmount) {
        summaryTotalAmount.textContent = `${formatNumber(summary.totalGrossAmount)} PLN`;
      }
      reportSummary.hidden = false;
    }

    function setReportExportEnabled(enabled: boolean) {
      if (reportExportCsvButton) reportExportCsvButton.disabled = !enabled;
      if (reportExportExcelButton) reportExportExcelButton.disabled = !enabled;
    }

    function validateReportRange() {
      const fromDate = (reportDateFrom?.value ?? "").trim();
      const toDate = (reportDateTo?.value ?? "").trim();
      if (!isDateWithinAllowedRange(fromDate) || !isDateWithinAllowedRange(toDate)) {
        showAppToast("Daty raportu muszą być w zakresie od 01.01.1940 do 31.12.2050.", "error");
        return null;
      }
      if (fromDate && toDate && fromDate > toDate) {
        showAppToast("Zakres dat jest nieprawidłowy (data od jest późniejsza niż data do).", "error");
        return null;
      }
      return { fromDate, toDate };
    }

    async function buildTaskReport(fromDate: string, toDate: string) {
      await ensureHelpTable();
      const db = await getDb();
      const filter = buildHelpDateFilter(fromDate, toDate);
      const summary = await buildReportSummary(fromDate, toDate);
      type TaskRow = {
        help_type_label: string | null;
        entries_count: number | null;
        total_quantity: number | null;
        total_amount: number | null;
      };
      const rows = await db.select<TaskRow[]>(
        `SELECT
          COALESCE(he.help_type_label, '(brak)') AS help_type_label,
          COUNT(*) AS entries_count,
          ROUND(SUM(COALESCE(he.help_quantity, 0)), 2) AS total_quantity,
          ROUND(SUM(COALESCE(he.help_amount, 0) * COALESCE(he.help_quantity, 1)), 2) AS total_amount
         FROM person_help_entries he
         ${filter.whereSql}
         GROUP BY COALESCE(he.help_type_label, '(brak)')
         ORDER BY total_amount DESC, help_type_label ASC`,
        filter.params
      );

      return {
        kind: "task",
        fromDate,
        toDate,
        title: "Raport według zadań",
        headers: ["Zadanie", "Liczba wpisów", "Suma ilości", "Suma kwot (PLN)"],
        rows: rows.map((row) => [
          row.help_type_label ?? "(brak)",
          String(row.entries_count ?? 0),
          formatNumber(Number(row.total_quantity ?? 0)),
          formatNumber(Number(row.total_amount ?? 0)),
        ]),
        summary,
      } satisfies ReportDataset;
    }

    async function buildPersonReport(fromDate: string, toDate: string) {
      await ensureHelpTable();
      const db = await getDb();
      const filter = buildHelpDateFilter(fromDate, toDate);
      const summary = await buildReportSummary(fromDate, toDate);
      type PersonRow = {
        first_name: string | null;
        last_name: string | null;
        pesel: string | null;
        entries_count: number | null;
        total_amount: number | null;
        help_type_label: string | null;
      };
      const rows = await db.select<PersonRow[]>(
        `SELECT
          p.first_name,
          p.last_name,
          p.pesel,
          COUNT(he.id) AS entries_count,
          ROUND(SUM(COALESCE(he.help_amount, 0) * COALESCE(he.help_quantity, 1)), 2) AS total_amount,
          COALESCE(he.help_type_label, '(brak)') AS help_type_label
         FROM person_help_entries he
         JOIN authorized_persons p ON p.id = he.person_id
         ${filter.whereSql}
         GROUP BY p.id, p.first_name, p.last_name, p.pesel, COALESCE(he.help_type_label, '(brak)')
         ORDER BY p.last_name ASC, p.first_name ASC, help_type_label ASC`,
        filter.params
      );

      return {
        kind: "person",
        fromDate,
        toDate,
        title: "Raport według osób i udzielanej pomocy",
        headers: ["Osoba", "PESEL", "Liczba wpisów", "Suma kwot (PLN)", "Rodzaj wsparcia"],
        rows: rows.map((row) => [
          `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "(brak)",
          row.pesel ?? "-",
          String(row.entries_count ?? 0),
          formatNumber(Number(row.total_amount ?? 0)),
          row.help_type_label ?? "(brak)",
        ]),
        summary,
      } satisfies ReportDataset;
    }

    async function buildAllDataReport(fromDate: string, toDate: string) {
      await ensureHelpTable();
      const db = await getDb();
      const filter = buildHelpDateFilter(fromDate, toDate);
      const summary = await buildReportSummary(fromDate, toDate);
      type AllRow = {
        help_date: string | null;
        first_name: string | null;
        last_name: string | null;
        pesel: string | null;
        help_type_label: string | null;
        help_amount: number | null;
        help_quantity: number | null;
        total_amount: number | null;
        help_provider: string | null;
      };
      const rows = await db.select<AllRow[]>(
        `SELECT
          he.help_date,
          p.first_name,
          p.last_name,
          p.pesel,
          COALESCE(he.help_type_label, '(brak)') AS help_type_label,
          he.help_amount,
          he.help_quantity,
          ROUND(COALESCE(he.help_amount, 0) * COALESCE(he.help_quantity, 1), 2) AS total_amount,
          he.help_provider
         FROM person_help_entries he
         JOIN authorized_persons p ON p.id = he.person_id
         ${filter.whereSql}
         ORDER BY he.help_date DESC, he.id DESC`,
        filter.params
      );

      return {
        kind: "all",
        fromDate,
        toDate,
        title: "Raport wszystkie dane",
        headers: [
          "Data pomocy",
          "Osoba",
          "PESEL",
          "Rodzaj wsparcia",
          "Kwota (PLN)",
          "Ilość",
          "Suma (PLN)",
          "Osoba udzielająca",
        ],
        rows: rows.map((row) => [
          row.help_date ?? "-",
          `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "(brak)",
          row.pesel ?? "-",
          row.help_type_label ?? "(brak)",
          formatNumber(Number(row.help_amount ?? 0)),
          String(row.help_quantity ?? 0),
          formatNumber(Number(row.total_amount ?? 0)),
          row.help_provider ?? "-",
        ]),
        summary,
      } satisfies ReportDataset;
    }

    async function buildWorkerActivityReport(fromDate: string, toDate: string) {
      await ensureHelpTable();
      const db = await getDb();
      const filter = buildHelpDateFilter(fromDate, toDate);
      const summary = await buildReportSummary(fromDate, toDate);
      type WorkerRow = {
        help_provider: string | null;
        entries_count: number | null;
        total_quantity: number | null;
        total_amount: number | null;
      };
      const rows = await db.select<WorkerRow[]>(
        `SELECT
          COALESCE(NULLIF(TRIM(he.help_provider), ''), '(brak)') AS help_provider,
          COUNT(*) AS entries_count,
          ROUND(SUM(COALESCE(he.help_quantity, 0)), 2) AS total_quantity,
          ROUND(SUM(COALESCE(he.help_amount, 0) * COALESCE(he.help_quantity, 1)), 2) AS total_amount
         FROM person_help_entries he
         ${filter.whereSql}
         GROUP BY COALESCE(NULLIF(TRIM(he.help_provider), ''), '(brak)')
         ORDER BY total_amount DESC, help_provider ASC`,
        filter.params
      );

      return {
        kind: "worker",
        fromDate,
        toDate,
        title: "Raport według aktywności pracowników",
        headers: ["Pracownik", "Liczba wpisów", "Suma ilości", "Suma kwot (PLN)"],
        rows: rows.map((row) => [
          row.help_provider ?? "(brak)",
          String(row.entries_count ?? 0),
          formatNumber(Number(row.total_quantity ?? 0)),
          formatNumber(Number(row.total_amount ?? 0)),
        ]),
        summary,
      } satisfies ReportDataset;
    }

    async function buildReportSummary(fromDate: string, toDate: string) {
      await ensureHelpTable();
      const db = await getDb();
      const filter = buildHelpDateFilter(fromDate, toDate);
      type SummaryRow = {
        entries_count: number | null;
        total_quantity: number | null;
        total_amount: number | null;
        total_gross_amount: number | null;
      };
      const rows = await db.select<SummaryRow[]>(
        `SELECT
          COUNT(*) AS entries_count,
          ROUND(SUM(COALESCE(he.help_quantity, 0)), 2) AS total_quantity,
          ROUND(SUM(COALESCE(he.help_amount, 0)), 2) AS total_amount,
          ROUND(SUM(COALESCE(he.help_amount, 0) * COALESCE(he.help_quantity, 1)), 2) AS total_gross_amount
         FROM person_help_entries he
         ${filter.whereSql}`,
        filter.params
      );
      const row = rows[0];
      return {
        entriesCount: Number(row?.entries_count ?? 0),
        totalQuantity: Number(row?.total_quantity ?? 0),
        totalAmount: Number(row?.total_amount ?? 0),
        totalGrossAmount: Number(row?.total_gross_amount ?? 0),
      } satisfies ReportSummary;
    }

    function reportDateRangeLabel(fromDate: string, toDate: string) {
      if (fromDate && toDate) return `${fromDate} - ${toDate}`;
      if (fromDate) return `od ${fromDate}`;
      if (toDate) return `do ${toDate}`;
      return "cały okres";
    }

    function reportSummaryRows(summary: ReportSummary, fromDate: string, toDate: string) {
      return [
        ["Zakres dat", reportDateRangeLabel(fromDate, toDate)],
        ["Liczba wpisów", String(summary.entriesCount)],
        ["Suma ilości", formatNumber(summary.totalQuantity)],
        ["Suma kwot (PLN)", formatNumber(summary.totalAmount)],
        ["Suma kwot całkowitych (PLN)", formatNumber(summary.totalGrossAmount)],
      ];
    }

    function normalizePathWithExtension(path: string, extension: string) {
      return path.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? path : `${path}.${extension}`;
    }

    async function saveReportBytesToPath(
      bytes: Uint8Array,
      options: {
        title: string;
        defaultPath: string;
        extension: "csv" | "xlsx";
        filterName: string;
      }
    ) {
      const selectedPath = await save({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: [{ name: options.filterName, extensions: [options.extension] }],
      });
      if (!selectedPath) return null;
      const finalPath = normalizePathWithExtension(selectedPath, options.extension);
      const fileBase64 = toBase64(bytes);
      return invoke<string>("save_report_file_to_path", {
        targetPath: finalPath,
        fileBase64,
      });
    }

    function buildColumnWidths(rows: string[][]): number[] {
      const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 1);
      const widths = Array.from({ length: maxColumns }, () => 12);
      for (const row of rows) {
        row.forEach((cell, index) => {
          const width = Math.min(60, Math.max(12, String(cell ?? "").length + 2));
          widths[index] = Math.max(widths[index], width);
        });
      }
      return widths;
    }

    async function buildWorkbookBytes(sheets: Array<{ name: string; rows: string[][] }>) {
      const ExcelJS = await loadExcelJs();
      const workbook = new ExcelJS.Workbook();
      for (const sheet of sheets) {
        const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
        sheet.rows.forEach((row) => {
          worksheet.addRow(row);
        });
        const widths = buildColumnWidths(sheet.rows);
        widths.forEach((width, index) => {
          worksheet.getColumn(index + 1).width = width;
        });
      }
      const output = await workbook.xlsx.writeBuffer();
      return new Uint8Array(output as ArrayBuffer);
    }

    function buildReportTableRows(report: ReportDataset) {
      const summaryRows = reportSummaryRows(report.summary, report.fromDate, report.toDate);
      return [
        [report.title],
        ...summaryRows,
        [],
        report.headers,
        ...report.rows,
      ];
    }

    async function exportCurrentReportAsCsv() {
      if (!currentReport) return false;
      const fileBaseName = await buildReportsFileBaseName();
      const csvContent = buildReportTableRows(currentReport)
        .map((row) => row.map((cell) => escapeCsvCell(String(cell ?? ""))).join(";"))
        .join("\r\n");
      const savedPath = await saveReportBytesToPath(new TextEncoder().encode(`\uFEFF${csvContent}`), {
        title: "Zapisz raport CSV",
        defaultPath: `${fileBaseName}.csv`,
        extension: "csv",
        filterName: "CSV",
      });
      if (!savedPath) return false;
      showAppToast(`Zapisano raport: ${savedPath}`, "success");
      return true;
    }

    async function exportCurrentReportAsExcel() {
      if (!currentReport) return false;
      const fileBaseName = await buildReportsFileBaseName();

      if (currentReport.kind !== "all") {
        const workbookBytes = await buildWorkbookBytes([
          {
            name: currentReport.title,
            rows: buildReportTableRows(currentReport),
          },
        ]);
        const savedPath = await saveReportBytesToPath(workbookBytes, {
          title: "Zapisz raport Excel",
          defaultPath: `${fileBaseName}.xlsx`,
          extension: "xlsx",
          filterName: "Excel",
        });
        if (!savedPath) return false;
        showAppToast(`Zapisano raport: ${savedPath}`, "success");
        return true;
      }

      const fromDate = currentReport.fromDate;
      const toDate = currentReport.toDate;

      await ensureOrgTable();
      const db = await getDb();
      const orgRows = await db.select<OrgSettings[]>(
        "SELECT org_name, center_name, contract_number, contact_person, contact_phone, contact_email FROM organization_settings WHERE id = 1 LIMIT 1"
      );
      const org = orgRows[0];

      const taskReport = await buildTaskReport(fromDate, toDate);
      const personReport = await buildPersonReport(fromDate, toDate);
      const workerReport = await buildWorkerActivityReport(fromDate, toDate);

      const workbookBytes = await buildWorkbookBytes([
        {
          name: "Dane organizacji",
          rows: [
            ["Dane organizacji"],
            ["Zakres raportu", reportDateRangeLabel(fromDate, toDate)],
            [],
            ["Pole", "Wartość"],
            ["Nazwa organizacji", org?.org_name ?? "-"],
            ["Nazwa ośrodka", org?.center_name ?? "-"],
            ["Nr umowy", org?.contract_number ?? "-"],
            ["Osoba kontaktowa", org?.contact_person ?? "-"],
            ["Telefon kontaktowy", org?.contact_phone ?? "-"],
            ["Email kontaktowy", org?.contact_email ?? "-"],
          ],
        },
        {
          name: "Podział na zadania",
          rows: buildReportTableRows(taskReport),
        },
        {
          name: "Według osób",
          rows: buildReportTableRows(personReport),
        },
        {
          name: "Aktywność pracowników",
          rows: buildReportTableRows(workerReport),
        },
      ]);

      const savedPath = await saveReportBytesToPath(workbookBytes, {
        title: "Zapisz raport Excel",
        defaultPath: `${fileBaseName}.xlsx`,
        extension: "xlsx",
        filterName: "Excel",
      });
      if (!savedPath) return false;
      showAppToast(`Zapisano raport: ${savedPath}`, "success");
      return true;
    }

    type ReportTab = "tasks" | "clients" | "workers" | "all";

    function setInlineMessage(
      element: HTMLDivElement | null,
      text: string,
      variant: "success" | "error" | "info" = "info"
    ) {
      if (!element) return;
      element.textContent = text;
      element.hidden = false;
      element.classList.remove("success", "error");
      if (variant === "success" || variant === "error") {
        element.classList.add(variant);
      }
    }

    function clearInlineMessage(element: HTMLDivElement | null) {
      if (!element) return;
      element.textContent = "";
      element.hidden = true;
      element.classList.remove("success", "error");
    }

    function buildImportReportMessage(result: ImportDbResult) {
      return (
        `Import zakończony (${result.mode}). ` +
        `Dodano osób: ${result.imported_persons}; ` +
        `Pominięto duplikaty osób: ${result.skipped_duplicate_persons ?? 0}; ` +
        `Dodano wpisów pomocy: ${result.imported_help_entries}; ` +
        `Pominięto duplikaty pomocy: ${result.skipped_duplicate_help_entries ?? 0}; ` +
        `Dodano kont użytkowników: ${result.imported_users ?? 0}.`
      );
    }

    function getSelectedReportTabs(): ReportTab[] {
      return reportItems
        .filter((item) => item.checked)
        .map((item) => item.value)
        .filter((value): value is ReportTab =>
          value === "tasks" || value === "clients" || value === "workers" || value === "all"
        );
    }

    async function getReportForTab(tab: ReportTab, fromDate: string, toDate: string) {
      if (tab === "tasks") return buildTaskReport(fromDate, toDate);
      if (tab === "clients") return buildPersonReport(fromDate, toDate);
      if (tab === "workers") return buildWorkerActivityReport(fromDate, toDate);
      return buildAllDataReport(fromDate, toDate);
    }

    async function exportReportsAsCsv(reports: ReportDataset[]) {
      if (!reports.length) return false;
      if (reports.length === 1) {
        currentReport = reports[0];
        return exportCurrentReportAsCsv();
      }

      const fileBaseName = await buildReportsFileBaseName();
      const blocks = reports.map((report) => {
        const rows = [...buildReportTableRows(report), []];
        return rows.map((row) => row.map((cell) => escapeCsvCell(String(cell ?? ""))).join(";"));
      });
      const csv = blocks.flat().join("\r\n");
      const savedPath = await saveReportBytesToPath(new TextEncoder().encode(`\uFEFF${csv}`), {
        title: "Zapisz raport CSV",
        defaultPath: `${fileBaseName}.csv`,
        extension: "csv",
        filterName: "CSV",
      });
      if (!savedPath) return false;
      showAppToast(`Zapisano raport: ${savedPath}`, "success");
      return true;
    }

    async function exportReportsAsExcel(reports: ReportDataset[]) {
      if (!reports.length) return false;
      if (reports.length === 1) {
        currentReport = reports[0];
        return exportCurrentReportAsExcel();
      }

      const fileBaseName = await buildReportsFileBaseName();
      const sheets = reports.map((report) => {
        return {
          name: report.title,
          rows: buildReportTableRows(report),
        };
      });
      const workbookBytes = await buildWorkbookBytes(sheets);
      const savedPath = await saveReportBytesToPath(workbookBytes, {
        title: "Zapisz raport Excel",
        defaultPath: `${fileBaseName}.xlsx`,
        extension: "xlsx",
        filterName: "Excel",
      });
      if (!savedPath) return false;
      showAppToast(`Zapisano raport: ${savedPath}`, "success");
      return true;
    }

    if (reportsPage) {
      setReportExportEnabled(false);
      renderReportPreview(null);
      renderReportSummary(null);
      clearInlineMessage(reportMessage);
      clearInlineMessage(reportContent);
      clearInlineMessage(backupExportMsg);
      clearInlineMessage(backupImportMsg);

      const updateImportModeUi = () => {
        const isMerge = importModeToggle?.checked ?? true;
        if (importModeValue) {
          importModeValue.textContent = isMerge ? "Dopisz do bazy" : "Podmień bazę";
        }
        if (importModeHint) {
          importModeHint.textContent = isMerge
            ? "Tryb importu: Dopisz do bazy (zachowuje istniejące dane)."
            : "Tryb importu: Podmień bazę (nadpisuje dane).";
        }
      };
      importModeToggle?.addEventListener("change", updateImportModeUi);
      updateImportModeUi();

      const runSelectedReports = async (useAll = false) => {
        clearInlineMessage(reportMessage);
        setInlineMessage(reportContent, "Generowanie raportu...");

        try {
          const selectedTabs = useAll
            ? (["tasks", "clients", "workers", "all"] as ReportTab[])
            : getSelectedReportTabs();
          if (!selectedTabs.length) {
            setInlineMessage(reportMessage, "Wybierz co najmniej jeden element raportu.", "error");
            setInlineMessage(reportContent, "Wybierz elementy i kliknij „Generuj”.");
            return;
          }

          const range = validateReportRange();
          if (!range) {
            setInlineMessage(reportContent, "Nie udało się wygenerować raportu.", "error");
            return;
          }

          const reports = await Promise.all(
            selectedTabs.map((tab) => getReportForTab(tab, range.fromDate, range.toDate))
          );
          const summary = reports.reduce(
            (acc, report) => ({
              entriesCount: acc.entriesCount + report.summary.entriesCount,
              totalQuantity: acc.totalQuantity + report.summary.totalQuantity,
              totalAmount: acc.totalAmount + report.summary.totalAmount,
              totalGrossAmount: acc.totalGrossAmount + report.summary.totalGrossAmount,
            }),
            { entriesCount: 0, totalQuantity: 0, totalAmount: 0, totalGrossAmount: 0 }
          );
          renderReportSummary(summary);
          currentReport = reports[0] ?? null;
          renderReportPreview(currentReport);

          const isExcel = (reportFormatSelect?.value ?? "csv") === "xlsx";
          const exported = isExcel ? await exportReportsAsExcel(reports) : await exportReportsAsCsv(reports);
          if (exported) {
            setInlineMessage(reportContent, "Raport wygenerowany i zapisany.", "success");
          } else {
            setInlineMessage(reportContent, "Anulowano zapis raportu.");
          }
        } catch (error) {
          console.error("Błąd generowania raportu:", error);
          setInlineMessage(reportMessage, "Błąd raportu. Szczegóły w konsoli.", "error");
          setInlineMessage(reportContent, "Nie udało się wygenerować raportu.", "error");
        }
      };

      reportGenerateButton?.addEventListener("click", () => {
        void runSelectedReports(false);
      });
      reportGenerateAllButton?.addEventListener("click", () => {
        reportItems.forEach((item) => {
          item.checked = true;
        });
        void runSelectedReports(true);
      });

      dbExportButton?.addEventListener("click", async () => {
        clearInlineMessage(backupExportMsg);
        try {
          const fileBaseName = await buildDatabaseFileBaseName();
          const selectedPath = await save({
            title: "Zapisz kopię bazy danych",
            defaultPath: `${fileBaseName}.db`,
            filters: [{ name: "Baza SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
          });
          if (!selectedPath) return;
          const savedPath = await invoke<string>("export_database_to_path", {
            targetPath: selectedPath,
            dbPath: getActiveDbPath(),
          });
          setInlineMessage(backupExportMsg, `Wyeksportowano bazę do: ${savedPath}`, "success");
        } catch (error) {
          console.error("Błąd eksportu bazy:", error);
          setInlineMessage(backupExportMsg, "Eksport bazy nieudany.", "error");
        }
      });

      dbExportEncryptedButton?.addEventListener("click", async () => {
        clearInlineMessage(backupExportMsg);
        try {
          const fileBaseName = await buildDatabaseFileBaseName();
          let selectedPath = await save({
            title: "Zapisz zaszyfrowaną bazę do wysyłki",
            defaultPath: `${fileBaseName}.7z`,
            filters: [
              { name: "7Z Archive", extensions: ["7z"] },
              { name: "RAR Archive", extensions: ["rar"] },
            ],
          });
          if (!selectedPath) return;
          let archiveKind: "rar" | "7z" = "7z";
          if (/\.rar$/i.test(selectedPath)) {
            archiveKind = "rar";
          } else if (/\.7z$/i.test(selectedPath)) {
            archiveKind = "7z";
          } else {
            selectedPath = `${selectedPath}.7z`;
          }

          const result = await invoke<PasswordArchiveResult>("export_encrypted_database_archive_to_path", {
            targetPath: selectedPath,
            archiveKind,
            dbPath: getActiveDbPath(),
          });
          setInlineMessage(
            backupExportMsg,
            `Dane zostały przygotowane do wysyłki. Proszę o wysyłkę pliku na adres eDoręczeń:\nAE:PL-45507-58621-HRWWR-20`,
            "success"
          );
          showAppToast(
            `Przygotowano plik do wysyłki: ${result.archivePath}`,
            "success"
          );
        } catch (error) {
          console.error("Błąd szyfrowanego eksportu bazy:", error);
          setInlineMessage(
            backupExportMsg,
            "Nie udało się przygotować zaszyfrowanej paczki do wysyłki.",
            "error"
          );
        }
      });

      const exportDbToPasswordArchive = async (kind: "rar" | "7z") => {
        clearInlineMessage(backupExportMsg);
        try {
          const fileBaseName = await buildDatabaseFileBaseName();
          const password = await promptArchivePassword({
            title: kind === "rar" ? "Pakowanie bazy do pliku RAR" : "Pakowanie bazy do pliku 7Z",
            hint:
              kind === "rar"
                ? "Nadaj hasło do pliku RAR. Hasło będzie wymagane do otwarcia archiwum."
                : "Nadaj hasło do pliku 7Z. Hasło będzie wymagane do otwarcia archiwum.",
          });
          if (password === null) return;

          let selectedPath = await save({
            title: kind === "rar" ? "Zapisz archiwum RAR" : "Zapisz archiwum 7Z",
            defaultPath:
              kind === "rar"
                ? `${fileBaseName}.rar`
                : `${fileBaseName}.7z`,
            filters: [
              kind === "rar"
                ? { name: "RAR Archive", extensions: ["rar"] }
                : { name: "7Z Archive", extensions: ["7z"] },
            ],
          });
          if (!selectedPath) return;
          if (kind === "rar" && !/\.rar$/i.test(selectedPath)) selectedPath = `${selectedPath}.rar`;
          if (kind === "7z" && !/\.7z$/i.test(selectedPath)) selectedPath = `${selectedPath}.7z`;

          const result = await invoke<PasswordArchiveResult>(
            kind === "rar" ? "create_password_protected_rar" : "create_password_protected_7z",
            {
              outPath: selectedPath,
              password,
              dbPath: getActiveDbPath(),
              archiveEntryName: `${fileBaseName}.db`,
            }
          );
          setInlineMessage(
            backupExportMsg,
            `Zapisano hasłowany plik ${kind.toUpperCase()}: ${result.archivePath} (narzędzie: ${result.toolUsed}, wejście: ${result.inputBytes} B).`,
            "success"
          );
        } catch (error) {
          console.error(`Błąd tworzenia archiwum ${kind.toUpperCase()}:`, error);
          setInlineMessage(backupExportMsg, `Nie udało się utworzyć pliku ${kind.toUpperCase()}.`, "error");
        }
      };
      dbExportRarButton?.addEventListener("click", () => {
        void exportDbToPasswordArchive("rar");
      });
      dbExport7zButton?.addEventListener("click", () => {
        void exportDbToPasswordArchive("7z");
      });

      dbImportButton?.addEventListener("click", async () => {
        clearInlineMessage(backupImportMsg);
        try {
          const mode =
            dbImportMode?.value === "replace"
              ? "replace"
              : importModeToggle
                ? importModeToggle.checked
                  ? "append"
                  : "replace"
                : "append";

          if (mode === "replace") {
            const confirmed = await showAppConfirm(
              "Import podmieni aktualną bazę danych. Czy kontynuować?"
            );
            if (!confirmed) return;
          }

          let selectedPath: string | null = null;
          const selected = await open({
            multiple: false,
            filters: [{ name: "Baza SQLite", extensions: ["db", "sqlite", "sqlite3"] }],
          });
          if (typeof selected === "string") {
            selectedPath = selected;
          }

          if (!selectedPath && dbImportFile?.files?.[0]) {
            const file = dbImportFile.files[0];
            const arrayBuffer = await file.arrayBuffer();
            const base64 = toBase64(new Uint8Array(arrayBuffer));
            const result = await invoke<ImportDbResult>("import_database_base64", {
              databaseBase64: base64,
              mode,
              dbPath: getActiveDbPath(),
            });
            await closeDb();
            currentReport = null;
            renderReportPreview(null);
            renderReportSummary(null);
            setReportExportEnabled(false);
            setInlineMessage(
              backupImportMsg,
              buildImportReportMessage(result),
              "success"
            );
            await showImportReportDialog(result);
            return;
          }

          if (!selectedPath) {
            setInlineMessage(backupImportMsg, "Wybierz plik bazy danych do importu.", "error");
            return;
          }

          const result = await invoke<ImportDbResult>("import_database_from_path", {
            sourcePath: selectedPath,
            mode,
            dbPath: getActiveDbPath(),
          });
          await closeDb();
          currentReport = null;
          renderReportPreview(null);
          renderReportSummary(null);
          setReportExportEnabled(false);
          setInlineMessage(
            backupImportMsg,
            buildImportReportMessage(result),
            "success"
          );
          await showImportReportDialog(result);
        } catch (error) {
          console.error("Błąd importu bazy:", error);
          const errorMessage =
            String((error as { message?: string } | null)?.message ?? error ?? "").trim() ||
            "Nie udało się zaimportować bazy danych.";
          setInlineMessage(backupImportMsg, errorMessage, "error");
        }
      });
    }
    if (workersPage) {
      const isAdmin = currentUser.role === "Admin";
      const workersHeroEyebrow = document.querySelector<HTMLElement>("#workers-hero-eyebrow");
      const workersHeroTitle = document.querySelector<HTMLElement>("#workers-hero-title");
      const selfDataTitle = document.querySelector<HTMLElement>("#self-data-title");
      if (adminOnly) adminOnly.hidden = !isAdmin;
      if (adminPassword) adminPassword.hidden = !isAdmin;
      if (adminList) adminList.hidden = !isAdmin;
      if (workerSelfData) workerSelfData.hidden = isAdmin;
      if (workerSelfPassword) workerSelfPassword.hidden = isAdmin;

      if (!isAdmin) {
        if (workersHeroEyebrow) workersHeroEyebrow.textContent = "Moje dane";
        if (workersHeroTitle) workersHeroTitle.textContent = "Edycja danych konta";
        if (selfDataTitle) selfDataTitle.textContent = "Moje dane";
        document.title = "Moje dane";
      }

      async function loadWorkers() {
        const db = await getDb();
        return db.select<UserRow[]>(
          "SELECT id, username, password_hash, role, is_active, first_name, last_name, position FROM users ORDER BY id DESC"
        );
      }

      function renderWorkersRows(users: UserRow[]) {
        if (!workersList) return;
        workersList.innerHTML = "";
        if (!users.length) {
          const row = document.createElement("div");
          row.className = "list-row muted";
          row.innerHTML =
            "<span>Brak pracowników</span><span>-</span><span>-</span><span>-</span>";
          workersList.append(row);
          return;
        }
        users.forEach((user) => {
          const row = document.createElement("div");
          row.className = "list-row";
          row.dataset.userId = String(user.id);
          row.dataset.username = user.username;
          row.dataset.firstName = user.first_name ?? "";
          row.dataset.lastName = user.last_name ?? "";
          row.dataset.position = user.position ?? "";
          row.dataset.role = user.role;
          const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "(brak danych)";
          row.innerHTML = `
            <span>${fullName}</span>
            <span>
              <label class="toggle">
                <input type="checkbox" class="worker-active-toggle" ${user.is_active === 1 ? "checked" : ""} />
                <span class="toggle-ui"></span>
                <span class="toggle-text" aria-live="polite"></span>
              </label>
            </span>
            <span>${user.position ?? "-"}</span>
            <span>${user.username}</span>
          `;
          workersList.append(row);
        });
      }

      function generateUniqueLogin(firstName: string, lastName: string, users: UserRow[]) {
        const first = toLoginToken(firstName);
        const last = toLoginToken(lastName);
        const baseRaw = [first, last].filter(Boolean).join(".");
        const base = baseRaw || "pracownik";
        const existing = new Set(users.map((user) => user.username.toLowerCase()));
        if (!existing.has(base)) return base;
        let index = 2;
        while (existing.has(`${base}${index}`)) {
          index += 1;
        }
        return `${base}${index}`;
      }

      async function refreshAdminSections() {
        if (!isAdmin) return;
        const users = await loadWorkers();
        renderWorkersRows(users);
        if (workerUserSelect) {
          workerUserSelect.innerHTML = [
            `<option value="__new__">Nowy pracownik...</option>`,
            ...users.map(
              (user) =>
                `<option value="${user.id}" data-username="${user.username}" data-first-name="${user.first_name ?? ""}" data-last-name="${user.last_name ?? ""}" data-position="${user.position ?? ""}" data-role="${user.role}">${user.username}</option>`
            ),
          ].join("");
        }
        if (adminPasswordUser) {
          adminPasswordUser.innerHTML = users
            .map((user) => `<option value="${user.id}">${user.username}</option>`)
            .join("");
        }
      }

      if (isAdmin) {
        await refreshAdminSections();
        workerUserSelect?.addEventListener("change", () => {
          if (!workerForm || !workerUserSelect) return;
          const selected = workerUserSelect.selectedOptions[0];
          const isNew = workerUserSelect.value === "__new__";
          (workerForm.elements.namedItem("first_name") as HTMLInputElement).value = isNew
            ? ""
            : (selected?.getAttribute("data-first-name") ?? "");
          (workerForm.elements.namedItem("last_name") as HTMLInputElement).value = isNew
            ? ""
            : (selected?.getAttribute("data-last-name") ?? "");
          (workerForm.elements.namedItem("position") as HTMLInputElement).value = isNew
            ? ""
            : (selected?.getAttribute("data-position") ?? "");
          (workerForm.elements.namedItem("role") as HTMLSelectElement).value = isNew
            ? "Staff"
            : (selected?.getAttribute("data-role") as AppRole) ?? "Staff";
          (workerForm.elements.namedItem("password") as HTMLInputElement).value = "";
        });

        workersList?.addEventListener("change", (event) => {
          const target = event.target as HTMLElement;
          const checkbox = target.closest<HTMLInputElement>(".worker-active-toggle");
          if (!checkbox) return;
          const row = checkbox.closest<HTMLDivElement>(".list-row");
          if (!row) return;
          const userId = Number(row.dataset.userId ?? "0");
          if (!userId) return;

          void (async () => {
            try {
              const db = await getDb();
              await db.execute("UPDATE users SET is_active = ? WHERE id = ?", [
                checkbox.checked ? 1 : 0,
                userId,
              ]);
              row.dataset.active = checkbox.checked ? "1" : "0";
              setWorkersMessage(
                checkbox.checked
                  ? "Pracownik został aktywowany."
                  : "Pracownik został wyłączony.",
                "success"
              );
            } catch (error) {
              console.error("Błąd zmiany aktywności pracownika:", error);
              checkbox.checked = !checkbox.checked;
              setWorkersMessage("Nie udało się zmieniż statusu pracownika.", "error");
            }
          })();
        });

        workerReset?.addEventListener("click", () => {
          workerForm?.reset();
          if (workerUserSelect) {
            workerUserSelect.value = "__new__";
          }
        });

        workerForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!workerForm || !workerUserSelect) return;
          const formData = new FormData(workerForm);
          const selectedUserId = String(formData.get("selected_user_id") ?? "").trim();
          const isNewWorker = selectedUserId === "__new__";
          const workerId = isNewWorker ? "" : selectedUserId;
          const firstName = String(formData.get("first_name") ?? "").trim();
          const lastName = String(formData.get("last_name") ?? "").trim();
          const position = String(formData.get("position") ?? "").trim();
          const selectedUsername = workerUserSelect.selectedOptions[0]?.getAttribute("data-username") ?? "";
          const role = String(formData.get("role") ?? "Staff").trim() as AppRole;
          const password = String(formData.get("password") ?? "").trim();
          if (!firstName || !lastName || !position) {
            setWorkersMessage("Uzupełnij: imię, nazwisko i stanowisko.", "error");
            return;
          }
          const db = await getDb();
          try {
            if (workerId) {
              await db.execute(
                "UPDATE users SET first_name = ?, last_name = ?, position = ?, role = ? WHERE id = ?",
                [firstName, lastName, position, role, Number(workerId)]
              );
              if (password) {
                await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
                  password,
                  Number(workerId),
                ]);
              }
              setWorkersMessage(`Zapisano zmiany pracownika. Login: ${selectedUsername}`, "success");
            } else {
              if (!password) {
                setWorkersMessage("Dla nowego pracownika podaj hasło.", "error");
                return;
              }
              const users = await loadWorkers();
              const generatedLogin = generateUniqueLogin(firstName, lastName, users);
              await db.execute(
                "INSERT INTO users (username, password_hash, role, is_active, first_name, last_name, position) VALUES (?, ?, ?, 1, ?, ?, ?)",
                [generatedLogin, password, role, firstName, lastName, position]
              );
              setWorkersMessage(`Utworzono nowe konto. Przypisany login: ${generatedLogin}`, "success");
            }
            workerForm.reset();
            workerUserSelect.value = "__new__";
            await refreshAdminSections();
          } catch (error) {
            console.error("Błąd zapisu pracownika:", error);
            setWorkersMessage("Nie udało się zapisać pracownika.", "error");
          }
        });

        adminPasswordForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!adminPasswordForm) return;
          const formData = new FormData(adminPasswordForm);
          const userId = Number(String(formData.get("user_id") ?? "0"));
          const newPassword = String(formData.get("new_password") ?? "").trim();
          if (!userId || !newPassword) {
            setWorkersMessage("Wybierz użytkownika i podaj nowe hasło.", "error");
            return;
          }
          const db = await getDb();
          await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [newPassword, userId]);
          adminPasswordForm.reset();
          setWorkersMessage("Hasło zostało zmienione.", "success");
        });
      } else {
        const db = await getDb();
        const rows = await db.select<UserRow[]>(
          "SELECT id, username, password_hash, role, is_active, first_name, last_name, position FROM users WHERE id = ? LIMIT 1",
          [currentUser.id]
        );
        const profile = rows[0];
        if (selfDataForm) {
          (selfDataForm.elements.namedItem("first_name") as HTMLInputElement).value =
            profile?.first_name ?? "";
          (selfDataForm.elements.namedItem("last_name") as HTMLInputElement).value =
            profile?.last_name ?? "";
          (selfDataForm.elements.namedItem("position") as HTMLInputElement).value =
            profile?.position ?? "";
          (selfDataForm.elements.namedItem("username") as HTMLInputElement).value =
            profile?.username ?? currentUser.username;
        }

        selfDataForm?.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!selfDataForm) return;
          const formData = new FormData(selfDataForm);
          const firstName = String(formData.get("first_name") ?? "").trim();
          const lastName = String(formData.get("last_name") ?? "").trim();
          const position = String(formData.get("position") ?? "").trim();
          const username = String(formData.get("username") ?? "").trim();
          if (!username) {
            setWorkersDataMessage("Podaj login.", "error");
            return;
          }
          try {
            await db.execute(
              "UPDATE users SET first_name = ?, last_name = ?, position = ?, username = ? WHERE id = ?",
              [firstName || null, lastName || null, position || null, username, currentUser.id]
            );
            setSessionUser({ ...currentUser, username });
            setWorkersDataMessage("Zapisano moje dane.", "success");
          } catch (error) {
            console.error("Błąd zmiany danych użytkownika:", error);
            setWorkersDataMessage("Nie udało się zapisać danych (login może być zajęty).", "error");
          }
        });
      }

      selfPasswordForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!selfPasswordForm) return;
        const formData = new FormData(selfPasswordForm);
        const oldPassword = String(formData.get("old_password") ?? "").trim();
        const newPassword = String(formData.get("new_password") ?? "").trim();
        if (!newPassword) {
          setWorkersMessage("Podaj nowe hasło.", "error");
          return;
        }
        const db = await getDb();
        const rows = await db.select<UserRow[]>(
          "SELECT id, username, password_hash, role, is_active FROM users WHERE id = ? LIMIT 1",
          [currentUser.id]
        );
        const user = rows[0];
        if (!user) {
          setWorkersMessage("Nie znaleziono użytkownika.", "error");
          return;
        }
        if (currentUser.role !== "Admin" && user.password_hash !== oldPassword) {
          setWorkersMessage("Stare hasło jest nieprawidłowe.", "error");
          return;
        }
        await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [newPassword, currentUser.id]);
        selfPasswordForm.reset();
        setWorkersMessage("Hasło zostało zmienione.", "success");
      });
    }

    function setOrgFormDisabled(disabled: boolean) {
      if (!orgForm) return;
      const fields = orgForm.querySelectorAll<HTMLInputElement>("input");
      fields.forEach((field) => {
        field.disabled = disabled;
      });
      if (orgSave) orgSave.disabled = disabled;
      if (orgReadonlyHint) orgReadonlyHint.hidden = !disabled;
    }

    function setContractsMessage(text: string, variant: "success" | "error") {
      if (!contractsMessage) return;
      contractsMessage.textContent = text;
      contractsMessage.hidden = false;
      contractsMessage.classList.remove("success", "error");
      contractsMessage.classList.add(variant);
      showAppToast(text, variant);
    }

    function renderContractsList(records: ContractDatabaseRecord[]) {
      if (!contractsList) return;
      if (!records.length) {
        contractsList.innerHTML = `<div class="list-row muted"><span>Brak zapisanych umów</span><span>-</span><span>-</span><span>-</span></div>`;
        return;
      }

      contractsList.innerHTML = records
        .map((record) => {
          const title = escapeHtml(record.contract_number?.trim() || "(bez numeru umowy)");
          const details =
            [record.org_name?.trim(), record.center_name?.trim()].filter(Boolean).join(" • ") ||
            "brak danych organizacji";
          const detailsSafe = escapeHtml(details);
          const dbPathSafe = escapeHtml(record.db_path);
          return `
            <div class="list-row ${record.is_active ? "active-contract-row" : ""}" data-contract-db-path="${dbPathSafe}">
              <span>${title}${record.is_active ? " (aktywna)" : ""}</span>
              <span>${detailsSafe}</span>
              <span>${new Date(record.updated_at).toLocaleDateString("pl-PL")}</span>
              <span>
                ${
                  record.is_active
                    ? "-"
                    : `<button type="button" class="btn switch-contract-btn" data-db-path="${dbPathSafe}">Przełącz</button>
                       <button type="button" class="btn ghost delete-contract-btn" data-db-path="${dbPathSafe}">Usuń</button>`
                }
              </span>
            </div>
          `;
        })
        .join("");
    }

    async function refreshContractsUi() {
      const records = loadContractRegistry();
      renderContractsList(records);
      const active =
        records.find((record) => record.is_active === 1) ??
        records.find((record) => record.db_path === getActiveDbPath());
      if (contractsActiveLabel) {
        contractsActiveLabel.textContent = `Aktywna umowa: ${
          active?.contract_number?.trim() || "brak numeru"
        }`;
      }

      document.querySelectorAll<HTMLButtonElement>(".switch-contract-btn").forEach((button) => {
        button.onclick = async () => {
          const dbPath = button.dataset.dbPath ?? "";
          if (!dbPath) return;
          const confirmed = await showAppConfirm(
            "Przełączyć aplikację na wybraną bazę umowy? Po zmianie ekran zostanie odświeżony.",
            { confirmText: "Tak, przełącz" }
          );
          if (!confirmed) return;
          const record = loadContractRegistry().find((item) => item.db_path === dbPath);
          upsertContractRegistryRecord(
            dbPath,
            {
              contract_number: record?.contract_number ?? undefined,
              org_name: record?.org_name ?? undefined,
              center_name: record?.center_name ?? undefined,
            },
            true
          );
          await closeDb();
          rememberActiveDbPath(dbPath);
          window.location.reload();
        };
      });

      document.querySelectorAll<HTMLButtonElement>(".delete-contract-btn").forEach((button) => {
        button.onclick = async () => {
          const dbPath = button.dataset.dbPath ?? "";
          if (!dbPath) return;
          if (dbPath === getActiveDbPath()) {
            setContractsMessage("Nie można usunąć aktywnej umowy.", "error");
            return;
          }
          const confirmed = await showAppConfirm(
            "Usunąć wybraną umowę z listy i skasować jej plik bazy danych? Operacji nie można cofnąć."
          );
          if (!confirmed) return;
          try {
            await invoke("delete_contract_database", { dbPath });
            removeContractRegistryRecord(dbPath);
            await refreshContractsUi();
            setContractsMessage("Umowa została usunięta.", "success");
          } catch (error) {
            console.error("Błąd usuwania umowy:", error);
            setContractsMessage("Nie udało się usunąć wybranej umowy.", "error");
          }
        };
      });
    }

    if (orgForm) {
      try {
        await ensureOrgTable();
        const db = await getDb();
        const rows = await db.select<OrgSettings[]>(
          "SELECT * FROM organization_settings WHERE id = 1 LIMIT 1"
        );
        const org = rows[0];
        if (org) {
          (orgForm.elements.namedItem("org_name") as HTMLInputElement).value = org.org_name ?? "";
          (orgForm.elements.namedItem("center_name") as HTMLInputElement).value =
            org.center_name ?? "";
          (orgForm.elements.namedItem("contract_number") as HTMLInputElement).value =
            org.contract_number ?? "";
          (orgForm.elements.namedItem("contact_person") as HTMLInputElement).value =
            org.contact_person ?? "";
          (orgForm.elements.namedItem("contact_phone") as HTMLInputElement).value =
            org.contact_phone ?? "";
          (orgForm.elements.namedItem("contact_email") as HTMLInputElement).value =
            org.contact_email ?? "";
          setOrgFormDisabled(true);
        }
        await syncCurrentContractRegistry();
        await refreshContractsUi();
      } catch (error) {
        console.error("Nie udało się wczytać danych organizacji:", error);
      }
    }

    orgEdit?.addEventListener("click", () => {
      setOrgFormDisabled(false);
      orgSaveMessage?.setAttribute("hidden", "true");
    });

    orgForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        const formData = new FormData(orgForm);
        const payload = {
          org_name: String(formData.get("org_name") ?? "").trim(),
          center_name: String(formData.get("center_name") ?? "").trim(),
          contract_number: String(formData.get("contract_number") ?? "").trim(),
          contact_person: String(formData.get("contact_person") ?? "").trim(),
          contact_phone: String(formData.get("contact_phone") ?? "").trim(),
          contact_email: String(formData.get("contact_email") ?? "").trim(),
        };

        try {
          await ensureOrgTable();
          const db = await getDb();
          await db.execute(
            `INSERT INTO organization_settings (
              id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              org_name = excluded.org_name,
              center_name = excluded.center_name,
              contract_number = excluded.contract_number,
              contact_person = excluded.contact_person,
              contact_phone = excluded.contact_phone,
              contact_email = excluded.contact_email,
              updated_at = datetime('now')`,
            [
              payload.org_name || null,
              payload.center_name || null,
              payload.contract_number || null,
              payload.contact_person || null,
              payload.contact_phone || null,
              payload.contact_email || null,
            ]
          );
          upsertContractRegistryRecord(getActiveDbPath(), payload, true);
          await refreshContractsUi();

          if (orgSaveMessage) {
            setOrgMessage("Dane organizacji zostały zapisane.", "success");
          }
          setOrgFormDisabled(true);
        } catch (error) {
          console.error("Błąd zapisu danych organizacji:", error);
          setOrgMessage(
            "Nie udało się zapisać danych organizacji. Sprawdź logi w konsoli.",
            "error"
          );
        }
      })();
    });

    createContractDbButton?.addEventListener("click", () => {
      void (async () => {
        const contractNumber = (newContractNumberInput?.value ?? "").trim();
        if (!contractNumber) {
          setContractsMessage("Podaj numer nowej umowy.", "error");
          return;
        }

        const confirmed = await showAppConfirm(
          "Utworzyć nową, osobną bazę danych dla tej umowy i od razu na nią przełączyć?",
          { confirmText: "Tak, utwórz nową bazę danych" }
        );
        if (!confirmed) return;

        const previousDbPath = getActiveDbPath();
        try {
          const usersSnapshot = await snapshotUsers();
          const payload = {
            org_name: (orgForm?.elements.namedItem("org_name") as HTMLInputElement | null)?.value.trim() ?? "",
            center_name:
              (orgForm?.elements.namedItem("center_name") as HTMLInputElement | null)?.value.trim() ?? "",
            contract_number: contractNumber,
            contact_person:
              (orgForm?.elements.namedItem("contact_person") as HTMLInputElement | null)?.value.trim() ?? "",
            contact_phone:
              (orgForm?.elements.namedItem("contact_phone") as HTMLInputElement | null)?.value.trim() ?? "",
            contact_email:
              (orgForm?.elements.namedItem("contact_email") as HTMLInputElement | null)?.value.trim() ?? "",
          };
          const nextDbPath = `contract_${sanitizeDbPathPart(contractNumber) || "umowa"}_${Date.now()}.db`;

          await closeDb();
          rememberActiveDbPath(nextDbPath);
          await ensureAuthorizedPersonsSchemaUpgrades();
          await ensureHelpTable();
          await ensureOrgTable();
          await seedUsers(usersSnapshot);

          const db = await getDb();
          await db.execute(
            `INSERT INTO organization_settings (
              id, org_name, center_name, contract_number, contact_person, contact_phone, contact_email, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              org_name = excluded.org_name,
              center_name = excluded.center_name,
              contract_number = excluded.contract_number,
              contact_person = excluded.contact_person,
              contact_phone = excluded.contact_phone,
              contact_email = excluded.contact_email,
              updated_at = datetime('now')`,
            [
              payload.org_name || null,
              payload.center_name || null,
              payload.contract_number || null,
              payload.contact_person || null,
              payload.contact_phone || null,
              payload.contact_email || null,
            ]
          );
          upsertContractRegistryRecord(nextDbPath, payload, true);
          if (newContractNumberInput) newContractNumberInput.value = "";
          window.location.reload();
        } catch (error) {
          console.error("Błąd tworzenia bazy umowy:", error);
          await closeDb();
          if (typeof previousDbPath === "string" && previousDbPath.trim()) {
            rememberActiveDbPath(previousDbPath);
          }
          setContractsMessage("Nie udało się utworzyć nowej bazy umowy.", "error");
        }
      })();
    });
  })();
});
