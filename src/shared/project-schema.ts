import type { Board, InterBoardWire } from './board-types';
import type { Netlist } from './netlist-types';
import type { PiMapping } from './pi-types';

export interface Project {
  name: string;
  version: string;          // Schema version for forward compat
  boards: Board[];
  interBoardWires: InterBoardWire[];
  netlist: Netlist;
  piMapping?: PiMapping;
  metadata: ProjectMetadata;
}

export interface ProjectMetadata {
  created: string;          // ISO date
  modified: string;
  description?: string;
  tags?: string[];          // 'voicecard', 'juno-106', etc.
}

export function createEmptyProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    name,
    version: '0.1.0',
    boards: [
      {
        id: 'board-1',
        label: 'Board 1',
        position: { x: 0, y: 0 },
        placements: [],
        wires: [],
      },
    ],
    interBoardWires: [],
    netlist: {
      components: [],
      nets: [],
    },
    metadata: {
      created: now,
      modified: now,
    },
  };
}

export const PROJECT_FILE_EXTENSION = '.bb830';
