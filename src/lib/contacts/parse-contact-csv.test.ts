import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      headers: ['phone', 'name', 'tags'],
      customColumns: [],
      hasPhoneColumn: true,
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
          custom_fields: undefined,
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
          custom_fields: undefined,
        },
      ],
    });
  });

  it('parses dynamic additional columns into custom_fields', () => {
    const csv = `phone,name,order_no,amount,city,product,delivery_date,discount
+919876543210,Rahul,ORD-101,1500,Bengaluru,King Bed,2026-11-20,10%
+919876543211,Pooja,ORD-102,3200,Mumbai,Dining Set,2026-11-25,15%`;

    const result = parseContactCsv(csv);
    expect(result.customColumns).toEqual([
      'order_no',
      'amount',
      'city',
      'product',
      'delivery_date',
      'discount',
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].custom_fields).toEqual({
      order_no: 'ORD-101',
      amount: '1500',
      city: 'Bengaluru',
      product: 'King Bed',
      delivery_date: '2026-11-20',
      discount: '10%',
    });
    expect(result.rows[1].custom_fields).toEqual({
      order_no: 'ORD-102',
      amount: '3200',
      city: 'Mumbai',
      product: 'Dining Set',
      delivery_date: '2026-11-25',
      discount: '15%',
    });
  });

  it('keeps a row with an empty phone cell instead of dropping it silently', () => {
    const csv = `phone,name
+15551234567,Alice
,Bob`;

    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      phone: '',
      name: 'Bob',
      email: undefined,
      company: undefined,
      tagNames: [],
      custom_fields: undefined,
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      headers: ['phone', 'name'],
      customColumns: [],
      hasPhoneColumn: true,
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
          custom_fields: undefined,
        },
      ],
    });
  });
});
