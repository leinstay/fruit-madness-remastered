// js/game/fuel.js
import { FUEL } from '../config.js';
export const createFuel = () => ({ value: FUEL.MAX });
export function stepFuel(f) { f.value = Math.max(0, f.value - FUEL.DRAIN); }
export function addFuel(f, amount) { f.value = Math.min(FUEL.MAX, f.value + amount); }
