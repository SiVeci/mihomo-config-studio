import type { SchemaModule } from '../types.js';

/**
 * A deliberately small module standing in for a real Mihomo section. It has one
 * field of every shape the M0-2 exit criteria care about: enum, boolean,
 * integer with a port format, a credential, a free-form map, a string list, a
 * nested object and a conditionally visible field.
 */
export const sampleModule: SchemaModule = {
  manifest: {
    id: 'sample',
    root: ['sample'],
    version: '1.0.0',
    mihomo: { minVersion: '1.18.0' },
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['rule', 'global', 'direct'], default: 'rule' },
      'log-level': {
        type: 'string',
        enum: ['silent', 'error', 'warning', 'info', 'debug'],
        default: 'info',
      },
      'allow-lan': { type: 'boolean', default: false },
      'mixed-port': { type: 'integer', minimum: 0, maximum: 65535, default: 7890 },
      'bind-address': { type: 'string', default: '*' },
      secret: { type: 'string' },
      hosts: { type: 'object', additionalProperties: { type: 'string' } },
      'skip-domain': { type: 'array', items: { type: 'string' } },
      tun: { $ref: '#/$defs/tun' },
    },
    $defs: {
      tun: {
        type: 'object',
        properties: {
          enable: { type: 'boolean', default: false },
          stack: { type: 'string', enum: ['system', 'gvisor', 'mixed'], default: 'mixed' },
          'auto-route': { type: 'boolean', default: true },
        },
      },
    },
  },
  ui: {
    groups: [
      { id: 'general', label: 'group.general', order: 0 },
      { id: 'inbound', label: 'group.inbound', order: 10 },
      { id: 'controller', label: 'group.controller', order: 20, advanced: true },
    ],
    fields: {
      mode: {
        group: 'general',
        order: 1,
        label: 'field.mode',
        docs: 'https://wiki.metacubex.one/config/general/',
      },
      'log-level': { group: 'general', order: 2 },
      'allow-lan': { group: 'inbound', order: 1, safety: 'caution' },
      'mixed-port': { group: 'inbound', order: 2 },
      'bind-address': {
        group: 'inbound',
        order: 3,
        // Only meaningful once LAN access is on.
        visibleWhen: { op: 'eq', path: 'allow-lan', value: true },
        requiredWhen: { op: 'eq', path: 'allow-lan', value: true },
      },
      secret: { group: 'controller', order: 1 },
      tun: {
        group: 'inbound',
        order: 10,
        advanced: true,
        fields: {
          stack: { platforms: ['linux', 'windows', 'darwin', 'android'] },
        },
      },
    },
  },
};
