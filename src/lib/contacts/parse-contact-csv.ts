/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company and
 * dynamic custom fields.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
  /** Dynamic columns detected from CSV (e.g. order_no, amount, city, product). */
  custom_fields?: Record<string, string>;
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  headers: string[];
  customColumns: string[];
  /**
   * True when the CSV header includes the required `phone` column.
   * `rows` is empty both when the column is missing and when the file
   * simply has no usable data rows; callers that need to tell those
   * apart (to pick the right error message) read this flag.
   */
  hasPhoneColumn: boolean;
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      rows: [],
      headers: [],
      customColumns: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const rawHeaders = lines[0]
    .split(',')
    .map((h) => h.trim().replace(/["']/g, ''));
  const normalizedHeaders = rawHeaders.map((h) => h.toLowerCase());

  // Match phone header with common aliases
  const phoneIdx = normalizedHeaders.findIndex((h) =>
    ['phone', 'phone_number', 'mobile', 'contact', 'contact_number', 'whatsapp_number', 'tel'].includes(h)
  );
  if (phoneIdx === -1) {
    return {
      rows: [],
      headers: rawHeaders,
      customColumns: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const nameIdx = normalizedHeaders.findIndex((h) =>
    ['name', 'full_name', 'customer_name', 'first_name', 'contact_name'].includes(h)
  );
  const emailIdx = normalizedHeaders.findIndex((h) =>
    ['email', 'email_address'].includes(h)
  );
  const companyIdx = normalizedHeaders.findIndex((h) =>
    ['company', 'company_name', 'organization', 'org'].includes(h)
  );
  const tagsIdx = normalizedHeaders.findIndex((h) =>
    ['tags', 'tag'].includes(h)
  );

  // Collect dynamic custom columns that aren't the standard fields
  const standardIndices = new Set([phoneIdx, nameIdx, emailIdx, companyIdx, tagsIdx]);
  const customColumns: { name: string; index: number }[] = [];
  rawHeaders.forEach((name, index) => {
    if (!standardIndices.has(index) && name) {
      customColumns.push({ name, index });
    }
  });

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim() ?? '';

    const custom_fields: Record<string, string> = {};
    for (const col of customColumns) {
      const val = values[col.index]?.replace(/["']/g, '').trim();
      if (val !== undefined && val !== '') {
        custom_fields[col.name] = val;
      }
    }

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
      custom_fields:
        Object.keys(custom_fields).length > 0 ? custom_fields : undefined,
    });
  }

  return {
    rows,
    headers: rawHeaders,
    customColumns: customColumns.map((c) => c.name),
    hasPhoneColumn: true,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
