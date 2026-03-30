import type { BB830API } from '../main/preload';

declare global {
  interface Window {
    bb830: BB830API;
  }
}
