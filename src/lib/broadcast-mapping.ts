/**
 * Broadcast template variable auto-mapping & preview resolution.
 *
 * Automatically inspects the context of each template placeholder
 * (e.g. {{1}}, {{2}}, etc.) within the template body and suggests
 * matching fields from the selected audience (CSV columns, contact fields,
 * or custom fields).
 */

export type VariableType = 'static' | 'field' | 'custom_field';

export interface VariableMapping {
  type: VariableType;
  value: string;
}

export interface AvailableFieldOption {
  value: string;
  label: string;
  isCsv?: boolean;
}

/**
 * Extracts available field options from the given audience.
 * Standard fields: name, phone, email.
 * If audience is CSV, also extracts all dynamic column headers from the rows.
 */
export function extractAvailableFields(csvContacts?: {
  phone: string;
  name?: string;
  custom_fields?: Record<string, string | undefined>;
}[]): {
  allFields: string[];
  csvColumns: string[];
} {
  const customColsSet = new Set<string>();
  if (csvContacts && csvContacts.length > 0) {
    for (const c of csvContacts) {
      if (c.custom_fields) {
        for (const col of Object.keys(c.custom_fields)) {
          customColsSet.add(col);
        }
      }
    }
  }

  const csvColumns = Array.from(customColsSet);
  const allFields = ['name', 'phone', 'email', ...csvColumns];
  return { allFields, csvColumns };
}

interface HeuristicPattern {
  keywords: string[];
  fieldCandidates: string[];
}

const HEURISTIC_PATTERNS: HeuristicPattern[] = [
  {
    keywords: ['hello', 'hi', 'hey', 'dear', 'mr', 'mrs', 'ms', 'customer', 'name'],
    fieldCandidates: ['name', 'customer_name', 'client_name', 'first_name', 'full_name'],
  },
  {
    keywords: ['order', 'invoice', 'booking', 'tracking', 'order_no', 'order_id', 'ord', 'bill'],
    fieldCandidates: ['order_no', 'order_id', 'order', 'invoice_no', 'invoice', 'booking_id'],
  },
  {
    keywords: ['product', 'item', 'furniture', 'sofa', 'bed', 'chair', 'table', 'collection', 'model'],
    fieldCandidates: ['product', 'product_name', 'item', 'item_name', 'article'],
  },
  {
    keywords: ['amount', 'price', 'total', 'rs', 'inr', 'usd', 'balance', 'cost', 'pay', 'paid', 'due', 'rupees'],
    fieldCandidates: ['amount', 'total', 'price', 'total_amount', 'grand_total', 'due_amount'],
  },
  {
    keywords: ['city', 'location', 'address', 'branch', 'state', 'pincode', 'pin', 'town'],
    fieldCandidates: ['city', 'address', 'location', 'branch', 'state'],
  },
  {
    keywords: ['date', 'delivery', 'delivering', 'arriving', 'schedule', 'time', 'slot'],
    fieldCandidates: ['delivery_date', 'date', 'order_date', 'delivery_time', 'time'],
  },
  {
    keywords: ['discount', 'offer', 'coupon', 'code', 'promo', 'off', 'saving', 'deal'],
    fieldCandidates: ['discount', 'offer', 'coupon', 'promo_code', 'coupon_code'],
  },
  {
    keywords: ['phone', 'mobile', 'contact', 'whatsapp', 'cell', 'number'],
    fieldCandidates: ['phone', 'mobile', 'whatsapp_number', 'contact_number'],
  },
];

/**
 * Suggests variable mappings for a template body by analyzing the surrounding context of each placeholder.
 */
export function suggestVariableMappings(
  templateBody: string,
  placeholders: string[],
  availableFields: string[],
  customFields?: { id: string; name: string }[],
): Record<string, VariableMapping> {
  const suggestions: Record<string, VariableMapping> = {};
  const normalizedFields = availableFields.map((f) => ({
    raw: f,
    clean: f.toLowerCase().replace(/[\s_-]+/g, ''),
  }));

  // Track assigned fields so sequential variables prefer distinct fields when available
  const usedFields = new Set<string>();

  for (const placeholder of placeholders) {
    const key = placeholder.replace(/^\{\{|\}\}$/g, '').trim();

    // 1. Direct name match (e.g. {{name}} -> field 'name' or {{order_no}} -> 'order_no')
    const directMatch = normalizedFields.find(
      (f) => f.clean === key.toLowerCase().replace(/[\s_-]+/g, ''),
    );
    if (directMatch) {
      suggestions[key] = { type: 'field', value: directMatch.raw };
      usedFields.add(directMatch.raw);
      continue;
    }

    // 2. Direct match against custom field names
    if (customFields && customFields.length > 0) {
      const customMatch = customFields.find(
        (cf) => cf.name.toLowerCase().replace(/[\s_-]+/g, '') === key.toLowerCase().replace(/[\s_-]+/g, ''),
      );
      if (customMatch) {
        suggestions[key] = { type: 'custom_field', value: customMatch.id };
        continue;
      }
    }

    // 3. Positional variable (e.g. {{1}}, {{2}}): analyze the line/clause containing this placeholder
    const idx = templateBody.indexOf(placeholder);
    if (idx !== -1) {
      // Find the line containing the placeholder
      const lineStart = templateBody.lastIndexOf('\n', idx);
      const lineEnd = templateBody.indexOf('\n', idx + placeholder.length);
      const start = lineStart === -1 ? 0 : lineStart + 1;
      const end = lineEnd === -1 ? templateBody.length : lineEnd;
      const lineText = templateBody.slice(start, end).toLowerCase();

      // Also get a tightly bounded segment (don't cross into other {{placeholders}})
      const segmentText = lineText;

      let matchedField: string | null = null;

      // First check heuristic patterns for clear intent (e.g. "hello" -> name, "order" -> order_no)
      for (const pattern of HEURISTIC_PATTERNS) {
        const keywordHit = pattern.keywords.some((kw) => {
          const regex = new RegExp(`\\b${kw}\\b`, 'i');
          return regex.test(segmentText);
        });

        if (keywordHit) {
          // Find best matching candidate from available fields
          const candidate = pattern.fieldCandidates.find((cand) =>
            normalizedFields.some((f) => !usedFields.has(f.raw) && f.raw.toLowerCase() === cand),
          );
          if (candidate) {
            const found = normalizedFields.find((f) => f.raw.toLowerCase() === candidate);
            if (found) {
              matchedField = found.raw;
              break;
            }
          }
          // Partial match candidate (e.g. cand "order" matching "order_no")
          const partialCandidate = pattern.fieldCandidates.find((cand) =>
            normalizedFields.some(
              (f) =>
                !usedFields.has(f.raw) &&
                (f.raw.toLowerCase().includes(cand) || cand.includes(f.raw.toLowerCase())),
            ),
          );
          if (partialCandidate) {
            const found = normalizedFields.find(
              (f) =>
                !usedFields.has(f.raw) &&
                (f.raw.toLowerCase().includes(partialCandidate) ||
                  partialCandidate.includes(f.raw.toLowerCase())),
            );
            if (found) {
              matchedField = found.raw;
              break;
            }
          }
        }
      }

      // If heuristic patterns didn't match, check if any available field name appears in the line
      if (!matchedField) {
        for (const f of normalizedFields) {
          if (!usedFields.has(f.raw) && segmentText.includes(f.raw.toLowerCase())) {
            matchedField = f.raw;
            break;
          }
        }
      }

      if (matchedField) {
        suggestions[key] = { type: 'field', value: matchedField };
        usedFields.add(matchedField);
        continue;
      }
    }

    // 4. Default: static empty
    suggestions[key] = { type: 'static', value: '' };
  }

  return suggestions;
}

/**
 * Renders the preview text for a recipient with applied variable mappings.
 */
export function renderPreviewText(
  templateBody: string,
  placeholders: string[],
  variables: Record<string, VariableMapping>,
  recipient: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    custom_fields?: Record<string, string | undefined>;
  },
  customValues?: Map<string, string>,
): string {
  let text = templateBody;

  for (const placeholder of placeholders) {
    const key = placeholder.replace(/^\{\{|\}\}$/g, '');
    const mapping = variables[key];
    let replacement = placeholder;

    if (mapping) {
      if (mapping.type === 'static' && mapping.value) {
        replacement = mapping.value;
      } else if (mapping.type === 'field' && mapping.value) {
        const fieldMap: Record<string, string | undefined> = {
          name: recipient.name,
          phone: recipient.phone,
          email: recipient.email,
          company: recipient.company,
        };
        replacement = fieldMap[mapping.value] ?? recipient.custom_fields?.[mapping.value] ?? placeholder;
      } else if (mapping.type === 'custom_field' && mapping.value) {
        replacement =
          customValues?.get(mapping.value) ??
          recipient.custom_fields?.[mapping.value] ??
          placeholder;
      }
    }

    text = text.replaceAll(placeholder, replacement);
  }

  return text;
}
