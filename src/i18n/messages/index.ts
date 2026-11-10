/**
 * Root of the message tree. Each namespace module keeps all eight languages
 * side by side; `project()` (./define.ts) turns the tree into one catalog per
 * language.
 */
import { common, shell, nav, roles, toast, confirm, units, errors, status, purity, payment } from './core';
import { palettes, settings, permissions } from './settings';
import pages from './pages';

export const messageTree = {
  common,
  shell,
  nav,
  roles,
  toast,
  confirm,
  units,
  errors,
  status,
  purity,
  payment,
  palettes,
  settings,
  permissions,
  ...pages,
};
