import { create } from 'zustand';
import type { Board, Placement, Wire, InterBoardWire } from '../../shared/board-types';
import type { Component, Net, Netlist } from '../../shared/netlist-types';
import type { Project } from '../../shared/project-schema';
import { createEmptyProject } from '../../shared/project-schema';

interface CircuitState {
  project: Project;
  currentBoardId: string;
  filePath: string | null;
  dirty: boolean;

  // Project actions
  newProject: (name: string) => void;
  loadProject: (project: Project, filePath?: string) => void;
  setFilePath: (path: string) => void;

  // Board actions
  addBoard: (label: string) => void;
  removeBoard: (boardId: string) => void;
  setCurrentBoard: (boardId: string) => void;
  updateBoardLabel: (boardId: string, label: string) => void;
  updateBoardPosition: (boardId: string, x: number, y: number) => void;

  // Component actions
  addComponent: (component: Component, placement: Placement) => void;
  removeComponent: (componentId: string) => void;
  updateComponentParameter: (componentId: string, key: string, value: number) => void;
  moveComponent: (componentId: string, placement: Partial<Placement>) => void;

  // Wire actions
  addWire: (boardId: string, wire: Wire) => void;
  removeWire: (boardId: string, wireId: string) => void;
  addInterBoardWire: (wire: InterBoardWire) => void;
  removeInterBoardWire: (wireId: string) => void;

  // Net actions
  addNet: (net: Net) => void;
  removeNet: (netId: string) => void;

  // Helpers
  getCurrentBoard: () => Board;
  getBoard: (boardId: string) => Board | undefined;
}

let nextBoardNum = 2;

export const useCircuitStore = create<CircuitState>((set, get) => ({
  project: createEmptyProject('Untitled'),
  currentBoardId: 'board-1',
  filePath: null,
  dirty: false,

  newProject: (name: string) => {
    nextBoardNum = 2;
    set({
      project: createEmptyProject(name),
      currentBoardId: 'board-1',
      filePath: null,
      dirty: false,
    });
  },

  loadProject: (project: Project, filePath?: string) => {
    nextBoardNum = project.boards.length + 1;
    set({
      project,
      currentBoardId: project.boards[0]?.id ?? 'board-1',
      filePath: filePath ?? null,
      dirty: false,
    });
  },

  setFilePath: (path: string) => set({ filePath: path }),

  addBoard: (label: string) => set((state) => {
    if (state.project.boards.length >= 6) return state;
    const id = `board-${nextBoardNum++}`;
    const lastBoard = state.project.boards[state.project.boards.length - 1];
    const x = lastBoard ? lastBoard.position.x + 420 : 0;
    return {
      dirty: true,
      currentBoardId: id,
      project: {
        ...state.project,
        boards: [...state.project.boards, {
          id,
          label,
          position: { x, y: 0 },
          placements: [],
          wires: [],
        }],
      },
    };
  }),

  removeBoard: (boardId: string) => set((state) => {
    if (state.project.boards.length <= 1) return state;
    const boards = state.project.boards.filter(b => b.id !== boardId);
    return {
      dirty: true,
      currentBoardId: boards[0].id,
      project: { ...state.project, boards },
    };
  }),

  setCurrentBoard: (boardId: string) => set({ currentBoardId: boardId }),

  updateBoardLabel: (boardId: string, label: string) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      boards: state.project.boards.map(b =>
        b.id === boardId ? { ...b, label } : b
      ),
    },
  })),

  updateBoardPosition: (boardId: string, x: number, y: number) => set((state) => ({
    project: {
      ...state.project,
      boards: state.project.boards.map(b =>
        b.id === boardId ? { ...b, position: { x, y } } : b
      ),
    },
  })),

  addComponent: (component: Component, placement: Placement) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      netlist: {
        ...state.project.netlist,
        components: [...state.project.netlist.components, component],
      },
      boards: state.project.boards.map(b =>
        b.id === placement.boardId
          ? { ...b, placements: [...b.placements, placement] }
          : b
      ),
    },
  })),

  removeComponent: (componentId: string) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      netlist: {
        ...state.project.netlist,
        components: state.project.netlist.components.filter(c => c.id !== componentId),
        nets: state.project.netlist.nets.map(n => ({
          ...n,
          connections: n.connections.filter(c => c.componentId !== componentId),
        })),
      },
      boards: state.project.boards.map(b => ({
        ...b,
        placements: b.placements.filter(p => p.componentId !== componentId),
      })),
    },
  })),

  updateComponentParameter: (componentId: string, key: string, value: number) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      netlist: {
        ...state.project.netlist,
        components: state.project.netlist.components.map(c =>
          c.id === componentId
            ? { ...c, parameters: { ...c.parameters, [key]: value } }
            : c
        ),
      },
    },
  })),

  moveComponent: (componentId: string, updates: Partial<Placement>) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      boards: state.project.boards.map(b => ({
        ...b,
        placements: b.placements.map(p =>
          p.componentId === componentId ? { ...p, ...updates } : p
        ),
      })),
    },
  })),

  addWire: (boardId: string, wire: Wire) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      boards: state.project.boards.map(b =>
        b.id === boardId
          ? { ...b, wires: [...b.wires, wire] }
          : b
      ),
    },
  })),

  removeWire: (boardId: string, wireId: string) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      boards: state.project.boards.map(b =>
        b.id === boardId
          ? { ...b, wires: b.wires.filter(w => w.id !== wireId) }
          : b
      ),
    },
  })),

  addInterBoardWire: (wire: InterBoardWire) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      interBoardWires: [...state.project.interBoardWires, wire],
    },
  })),

  removeInterBoardWire: (wireId: string) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      interBoardWires: state.project.interBoardWires.filter(w => w.id !== wireId),
    },
  })),

  addNet: (net: Net) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      netlist: {
        ...state.project.netlist,
        nets: [...state.project.netlist.nets, net],
      },
    },
  })),

  removeNet: (netId: string) => set((state) => ({
    dirty: true,
    project: {
      ...state.project,
      netlist: {
        ...state.project.netlist,
        nets: state.project.netlist.nets.filter(n => n.id !== netId),
      },
    },
  })),

  getCurrentBoard: () => {
    const state = get();
    return state.project.boards.find(b => b.id === state.currentBoardId)!;
  },

  getBoard: (boardId: string) => {
    return get().project.boards.find(b => b.id === boardId);
  },
}));
