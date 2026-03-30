/**
 * Renderer-side API command handler.
 * Polls for commands from the MCP server (via preload queue)
 * and executes them against the Zustand stores.
 */

import { useCircuitStore } from './stores/circuit-store';
import { COMPONENT_LIBRARY } from './panels/ComponentLibrary';
import type { BoardCol } from '../shared/board-types';

type ActionHandler = (payload: any) => any;

const handlers: Record<string, ActionHandler> = {

  'place_component': ({ type, label, boardId, row, col, row2, col2, parameters }) => {
    const store = useCircuitStore.getState();
    const bid = boardId ?? store.currentBoardId;
    const board = store.project.boards.find(b => b.id === bid);
    if (!board) return { error: `Board "${bid}" not found` };

    const def = COMPONENT_LIBRARY.find(c => c.type === type || c.name === type);
    if (!def) return { error: `Unknown component type "${type}"` };

    const componentId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const placement: any = {
      componentId,
      boardId: bid,
      pin1Position: { row, col },
      orientation: 0,
    };

    if (!def.package.startsWith('DIP') && def.type !== 'transistor') {
      if (row2 == null || col2 == null) return { error: `${type} requires row2 and col2` };
      // Enforce minimum span — components must span at least 3 rows or be diagonal across 2+ rows
      const rowSpan = Math.abs(row2 - row);
      const colSpan = Math.abs('abcdefghij'.indexOf(col2) - 'abcdefghij'.indexOf(col));
      if (rowSpan < 2 && colSpan < 2) return { error: `Passive must span at least 2 rows or be diagonal. Got ${col}${row}→${col2}${row2}` };
      if (rowSpan === 0 && col === col2) return { error: `Same hole — cannot place component` };
      placement.pin2Position = { row: row2, col: col2 };
    }
    if (def.type === 'transistor') {
      placement.pin2Position = { row: row + 2, col };
    }

    store.addComponent(
      {
        id: componentId,
        type: def.type,
        label: label ?? def.type,
        package: def.package,
        pins: [...def.pins],
        parameters: { ...def.defaultParameters, ...parameters },
      },
      placement,
    );

    return { id: componentId, label: label ?? def.type, position: `${col}${row}` };
  },

  'wire': ({ boardId, fromRow, fromCol, toRow, toCol, color }) => {
    const store = useCircuitStore.getState();
    const bid = boardId ?? store.currentBoardId;
    const wireId = `wire-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    store.addWire(bid, {
      id: wireId,
      from: { row: fromRow, col: fromCol as BoardCol },
      to: { row: toRow, col: toCol as BoardCol },
      color: color ?? 'blue',
    });

    return { id: wireId, from: `${fromCol}${fromRow}`, to: `${toCol}${toRow}` };
  },

  'remove': ({ id }) => {
    const store = useCircuitStore.getState();
    const comp = store.project.netlist.components.find(c => c.id === id);
    if (comp) {
      store.removeComponent(id);
      return { removed: 'component', id };
    }
    for (const board of store.project.boards) {
      if (board.wires.some(w => w.id === id)) {
        store.removeWire(board.id, id);
        return { removed: 'wire', id };
      }
    }
    return { error: `"${id}" not found` };
  },

  'set_parameter': ({ componentId, key, value }) => {
    useCircuitStore.getState().updateComponentParameter(componentId, key, value);
    return { ok: true };
  },

  'add_board': ({ label }) => {
    const store = useCircuitStore.getState();
    if (store.project.boards.length >= 6) return { error: 'Max 6 boards' };
    store.addBoard(label);
    const newBoard = store.project.boards[store.project.boards.length - 1];
    return { id: newBoard.id, label: newBoard.label };
  },

  'set_current_board': ({ boardId }) => {
    useCircuitStore.getState().setCurrentBoard(boardId);
    return { ok: true };
  },

  'get_netlist': () => {
    const { project } = useCircuitStore.getState();
    return {
      name: project.name,
      boards: project.boards.map(b => ({ id: b.id, label: b.label, components: b.placements.length, wires: b.wires.length })),
      components: project.netlist.components.map(c => ({ id: c.id, type: c.type, label: c.label, params: c.parameters })),
      nets: project.netlist.nets.length,
    };
  },

  'get_board_state': ({ boardId }) => {
    const store = useCircuitStore.getState();
    const bid = boardId ?? store.currentBoardId;
    const board = store.project.boards.find(b => b.id === bid);
    if (!board) return { error: `Board "${bid}" not found` };
    return {
      id: board.id, label: board.label,
      placements: board.placements.map(p => {
        const comp = store.project.netlist.components.find(c => c.id === p.componentId);
        return { id: p.componentId, type: comp?.type, label: comp?.label, pin1: `${p.pin1Position.col}${p.pin1Position.row}` };
      }),
      wires: board.wires.map(w => ({ id: w.id, from: `${(w.from as any).col}${(w.from as any).row}`, to: `${(w.to as any).col}${(w.to as any).row}`, color: w.color })),
    };
  },

  'new_project': ({ name }) => {
    useCircuitStore.getState().newProject(name ?? 'Untitled');
    return { ok: true };
  },

  'update_board_label': ({ boardId, label }) => {
    useCircuitStore.getState().updateBoardLabel(boardId, label);
    return { ok: true };
  },

  'list_components': () => {
    return COMPONENT_LIBRARY.map(c => ({
      type: c.type, name: c.name, category: c.category, package: c.package,
      pins: c.pins.map(p => `${p.index + 1}:${p.name}`),
    }));
  },
};

/** Start polling for API commands */
export function initApiHandler() {
  setInterval(() => {
    if (!window.bb830?.pollApiCommands) return;
    const commands = window.bb830.pollApiCommands();
    for (const { reqId, action, payload } of commands) {
      try {
        const handler = handlers[action];
        if (!handler) {
          window.bb830.apiResponse(reqId, null, `Unknown action: ${action}`);
          continue;
        }
        const result = handler(payload);
        window.bb830.apiResponse(reqId, result);
      } catch (err: any) {
        window.bb830.apiResponse(reqId, null, err.message);
      }
    }
  }, 50); // Poll every 50ms
}
