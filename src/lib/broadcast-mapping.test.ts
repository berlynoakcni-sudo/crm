import { describe, expect, it } from 'vitest';
import {
  extractAvailableFields,
  renderPreviewText,
  suggestVariableMappings,
} from './broadcast-mapping';

describe('broadcast-mapping', () => {
  describe('extractAvailableFields', () => {
    it('returns default fields when no csv contacts provided', () => {
      const { allFields, csvColumns } = extractAvailableFields();
      expect(allFields).toEqual(['name', 'phone', 'email']);
      expect(csvColumns).toEqual([]);
    });

    it('extracts unique custom columns from csv contacts', () => {
      const csvContacts: {
        phone: string;
        name: string;
        custom_fields: Record<string, string>;
      }[] = [
        {
          phone: '+15551230000',
          name: 'Alice',
          custom_fields: { order_no: 'ORD-1', amount: '100', city: 'Bengaluru' },
        },
        {
          phone: '+15559990000',
          name: 'Bob',
          custom_fields: { order_no: 'ORD-2', product: 'Sofa', amount: '200' },
        },
      ];
      const { allFields, csvColumns } = extractAvailableFields(csvContacts);
      expect(csvColumns).toContain('order_no');
      expect(csvColumns).toContain('amount');
      expect(csvColumns).toContain('city');
      expect(csvColumns).toContain('product');
      expect(allFields).toContain('name');
      expect(allFields).toContain('phone');
      expect(allFields).toContain('email');
    });
  });

  describe('suggestVariableMappings', () => {
    it('accurately maps prompt example: {{1}}->name, {{2}}->order_no, {{3}}->product, {{4}}->amount', () => {
      const template = `Hello {{1}}!
Your order {{2}} is confirmed.
Product: {{3}}
Amount: {{4}}`;
      const placeholders = ['{{1}}', '{{2}}', '{{3}}', '{{4}}'];
      const availableFields = ['name', 'phone', 'order_no', 'amount', 'city', 'product', 'delivery_date', 'discount'];

      const suggestions = suggestVariableMappings(template, placeholders, availableFields);

      expect(suggestions['1']).toEqual({ type: 'field', value: 'name' });
      expect(suggestions['2']).toEqual({ type: 'field', value: 'order_no' });
      expect(suggestions['3']).toEqual({ type: 'field', value: 'product' });
      expect(suggestions['4']).toEqual({ type: 'field', value: 'amount' });
    });

    it('handles direct named placeholders like {{name}} and {{order_no}}', () => {
      const template = 'Hi {{name}}, your order {{order_no}} is on the way!';
      const placeholders = ['{{name}}', '{{order_no}}'];
      const availableFields = ['name', 'phone', 'order_no', 'amount'];

      const suggestions = suggestVariableMappings(template, placeholders, availableFields);

      expect(suggestions['name']).toEqual({ type: 'field', value: 'name' });
      expect(suggestions['order_no']).toEqual({ type: 'field', value: 'order_no' });
    });

    it('falls back to static empty string when no match is found', () => {
      const template = 'Hello {{1}}, random mystery {{2}}!';
      const placeholders = ['{{1}}', '{{2}}'];
      const availableFields = ['name', 'phone'];

      const suggestions = suggestVariableMappings(template, placeholders, availableFields);

      expect(suggestions['1']).toEqual({ type: 'field', value: 'name' });
      expect(suggestions['2']).toEqual({ type: 'static', value: '' });
    });
  });

  describe('renderPreviewText', () => {
    it('substitutes contact fields, custom fields and static values', () => {
      const template = 'Hello {{1}}! Your order {{2}} for {{3}} totals {{4}}. Code: {{5}}';
      const placeholders = ['{{1}}', '{{2}}', '{{3}}', '{{4}}', '{{5}}'];
      const variables = {
        '1': { type: 'field' as const, value: 'name' },
        '2': { type: 'field' as const, value: 'order_no' },
        '3': { type: 'field' as const, value: 'product' },
        '4': { type: 'field' as const, value: 'amount' },
        '5': { type: 'static' as const, value: 'ROYAL20' },
      };

      const recipient = {
        name: 'Nikhil',
        phone: '+919876543210',
        custom_fields: {
          order_no: 'ORD-9876',
          product: 'Oak Dining Table',
          amount: '₹45,000',
        },
      };

      const preview = renderPreviewText(template, placeholders, variables, recipient);
      expect(preview).toBe(
        'Hello Nikhil! Your order ORD-9876 for Oak Dining Table totals ₹45,000. Code: ROYAL20'
      );
    });
  });
});
