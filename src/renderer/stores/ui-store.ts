import { create } from 'zustand';
import type { WireColor } from '../../shared/board-types';
import type { ComponentDefinition } from '../../shared/netlist-types';

export type ViewMode = 'breadboard' | 'schematic';
export type ToolMode = 'select' | 'place' | 'wire' | 'probe' | 'pan';

interface UIState {
  viewMode: ViewMode;
  toolMode: ToolMode;
  zoom: number;
  panOffset: { x: number; y: number };

  // Placement state
  selectedComponent: ComponentDefinition | null;
  wireColor: WireColor;

  // Selection state
  selectedItemId: string | null;
  selectedItemType: 'component' | 'wire' | null;
  hoveredHole: { row: number; col: string } | null;

  // Pin highlight (from property editor hover)
  hoveredPin: { componentId: string; pinIndex: number } | null;

  // Passive placement (two-click: pin1 then pin2)
  passivePin1: { row: number; col: string; boardId?: string } | null;

  // Wire drawing state (boardId tracks which board the wire starts on)
  wireStart: { row: number; col: string; boardId?: string } | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setToolMode: (mode: ToolMode) => void;
  setZoom: (zoom: number) => void;
  setPanOffset: (x: number, y: number) => void;
  setSelectedComponent: (def: ComponentDefinition | null) => void;
  setWireColor: (color: WireColor) => void;
  selectItem: (id: string | null, type: 'component' | 'wire' | null) => void;
  setHoveredHole: (hole: { row: number; col: string } | null) => void;
  setHoveredPin: (pin: { componentId: string; pinIndex: number } | null) => void;
  setPassivePin1: (pin: { row: number; col: string; boardId?: string } | null) => void;
  setWireStart: (start: { row: number; col: string; boardId?: string } | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  viewMode: 'breadboard',
  toolMode: 'select',
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  selectedComponent: null,
  wireColor: 'blue',
  selectedItemId: null,
  selectedItemType: null,
  hoveredHole: null,
  hoveredPin: null,
  passivePin1: null,
  wireStart: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setToolMode: (mode) => set({
    toolMode: mode,
    wireStart: null,
    passivePin1: null,
    selectedItemId: null,
    selectedItemType: null,
  }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(3, zoom)) }),
  setPanOffset: (x, y) => set({ panOffset: { x, y } }),
  setSelectedComponent: (def) => set({
    selectedComponent: def,
    toolMode: def ? 'place' : 'select',
    passivePin1: null,
  }),
  setWireColor: (color) => set({ wireColor: color }),
  selectItem: (id, type) => set({ selectedItemId: id, selectedItemType: type }),
  setHoveredHole: (hole) => set({ hoveredHole: hole }),
  setHoveredPin: (pin) => set({ hoveredPin: pin }),
  setPassivePin1: (pin) => set({ passivePin1: pin }),
  setWireStart: (start) => set({ wireStart: start }),
}));
