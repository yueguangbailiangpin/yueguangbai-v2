import { describe, expect, it } from 'vitest';
import {
  STAFF_MCP_MAX_LIMIT,
  STAFF_MCP_PROTOCOL_VERSION,
  STAFF_MCP_TOOL_NAMES,
} from './staff-mcp';

describe('Staff MCP v1 contract', () => {
  it('publishes only the frozen Staff tool names', () => {
    expect(STAFF_MCP_PROTOCOL_VERSION).toBe('2025-11-25');
    expect(STAFF_MCP_MAX_LIMIT).toBe(50);
    expect(STAFF_MCP_TOOL_NAMES).toHaveLength(13);
    expect(STAFF_MCP_TOOL_NAMES.every((name) => name.endsWith('_v1'))).toBe(true);
    expect(STAFF_MCP_TOOL_NAMES.join('|')).not.toMatch(
      /buyer_mcp|seller_mcp|sql|http|send|transfer|approve|finalize|export/iu,
    );
  });
});
