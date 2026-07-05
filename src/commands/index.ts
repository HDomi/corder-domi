import { connect } from "./connect";
import { disconnect } from "./disconnect";
import { plan } from "./plan";
import { coding } from "./coding";
import { apply } from "./apply";
import { deleteApp } from "./deleteApp";
import { logs } from "./logs";
import { spec } from "./spec";
import { deploy } from "./deploy";
import { Command } from "../types";

export const commands: Command[] = [
  connect,
  disconnect,
  plan,
  coding,
  apply,
  deleteApp,
  logs,
  spec,
  deploy,
];
