/**
 * Renderer-side API command handler.
 * Polls for commands from the MCP server (via preload queue)
 * and executes them against the Zustand stores.
 */

import { useCircuitStore } from './stores/circuit-store';
import { useSimStore } from './stores/sim-store';
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

  'derive_nets': () => {
    // Scan the breadboard and auto-generate nets from shared bus rows.
    // On a BB830: holes a-e on the same row share a bus, f-j share a bus.
    const store = useCircuitStore.getState();
    const board = store.project.boards[0];
    if (!board) return { error: 'No board' };

    // Build a map: bus key → list of { componentId, pinIndex }
    // Bus key = "row:side" e.g. "5:left" or "5:right"
    const busMap = new Map<string, Array<{ componentId: string; pinIndex: number }>>();

    function addToBus(row: number, col: string, componentId: string, pinIndex: number) {
      const ci = 'abcdefghij'.indexOf(col);
      if (ci < 0) return; // rail holes don't form buses
      const side = ci < 5 ? 'left' : 'right';
      const key = `${row}:${side}`;
      if (!busMap.has(key)) busMap.set(key, []);
      const bus = busMap.get(key)!;
      // Avoid duplicates
      if (!bus.some(e => e.componentId === componentId && e.pinIndex === pinIndex)) {
        bus.push({ componentId, pinIndex });
      }
    }

    // Map placements to bus entries
    for (const placement of board.placements) {
      const comp = store.project.netlist.components.find(c => c.id === placement.componentId);
      if (!comp) continue;

      if (comp.package.startsWith('DIP')) {
        // DIP: left pins at col e, right pins at col f
        const pinsPerSide = comp.pins.length / 2;
        for (let i = 0; i < pinsPerSide; i++) {
          addToBus(placement.pin1Position.row + i, 'e', comp.id, i); // left pin
          addToBus(placement.pin1Position.row + i, 'f', comp.id, comp.pins.length - 1 - i); // right pin
        }
      } else if (comp.type === 'transistor') {
        // Transistor: 3 pins in same column
        addToBus(placement.pin1Position.row - 1, placement.pin1Position.col, comp.id, 1); // Collector
        addToBus(placement.pin1Position.row, placement.pin1Position.col, comp.id, 0); // Base
        addToBus(placement.pin1Position.row + 1, placement.pin1Position.col, comp.id, 2); // Emitter
      } else {
        // 2-pin passive: pin1 and pin2
        addToBus(placement.pin1Position.row, placement.pin1Position.col, comp.id, 0);
        if (placement.pin2Position) {
          addToBus(placement.pin2Position.row, placement.pin2Position.col, comp.id, 1);
        }
      }
    }

    // Also add wire endpoints to the bus map (wires connect buses but don't have component pins)
    // Wires create connections between their endpoint buses

    // Now generate nets from buses with 2+ entries
    // Clear existing nets first
    const existingNets = store.project.netlist.nets.length;
    let netCount = 0;

    for (const [busKey, entries] of busMap) {
      if (entries.length < 2) continue;

      // Check if a net already exists for these exact connections
      const netName = `bus_${busKey.replace(':', '_')}`;
      const netId = `net-auto-${busKey.replace(':', '-')}`;

      store.addNet({
        id: netId,
        name: netName,
        connections: entries,
      });
      netCount++;
    }

    return { derived: netCount, totalBuses: busMap.size };
  },

  'add_net': ({ name, connections }) => {
    const store = useCircuitStore.getState();
    const id = `net-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    store.addNet({ id, name, connections });
    return { id, name, connections: connections.length };
  },

  'run_sim': ({ probeNetId, fidelity }) => {
    const circuitStore = useCircuitStore.getState();
    const simStore = useSimStore.getState();
    if (fidelity != null) simStore.setFidelity(fidelity);
    if (probeNetId) simStore.setProbeNet(probeNetId);
    const { components } = circuitStore.project.netlist;
    const nets = circuitStore.project.netlist.nets;
    simStore.start(
      components.map(c => ({ id: c.id, type: c.type, parameters: c.parameters })),
      nets.map(n => ({ id: n.id, connections: n.connections })),
    );
    return { status: 'running', probeNetId: simStore.probeNetId, components: components.length, nets: nets.length };
  },

  'stop_sim': () => {
    useSimStore.getState().stop();
    return { status: 'stopped' };
  },

  'set_probe': ({ netId }) => {
    useSimStore.getState().setProbeNet(netId);
    return { ok: true, probeNetId: netId };
  },

  'set_probe_b': ({ netId }) => {
    useSimStore.getState().setProbeNetB(netId);
    return { ok: true, probeNetIdB: netId };
  },

  'get_nets': () => {
    const { project } = useCircuitStore.getState();
    return project.netlist.nets.map(n => ({ id: n.id, name: n.name, connections: n.connections }));
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
