import { mergeRuleBindings } from "../binding";
import { BASIC_TEACHING_RULE_BINDINGS } from "./basicTeaching";
import { CHORD_RULE_BINDINGS } from "./chord";
import { CONNECTION_RULE_BINDINGS } from "./connection";
import { FUNCTION_RULE_BINDINGS } from "./function";
import { MELODY_RULE_BINDINGS } from "./melody";
import { NONCHORD_RULE_BINDINGS } from "./nonchord";
import { RHYTHM_CADENCE_TONALITY_RULE_BINDINGS } from "./rhythmCadenceTonality";
import { SPECIALIZED_CONNECTION_RULE_BINDINGS } from "./specializedConnections";
import { STATEFUL_RULE_BINDINGS } from "./stateful";
import { VOICE_RULE_BINDINGS } from "./voice";
import { VOICE_LEADING_RULE_BINDINGS } from "./voiceLeading";

export const BUILTIN_RULE_BINDINGS = mergeRuleBindings(
  VOICE_RULE_BINDINGS,
  VOICE_LEADING_RULE_BINDINGS,
  MELODY_RULE_BINDINGS,
  CHORD_RULE_BINDINGS,
  NONCHORD_RULE_BINDINGS,
  CONNECTION_RULE_BINDINGS,
  FUNCTION_RULE_BINDINGS,
  RHYTHM_CADENCE_TONALITY_RULE_BINDINGS,
  BASIC_TEACHING_RULE_BINDINGS,
  SPECIALIZED_CONNECTION_RULE_BINDINGS,
  STATEFUL_RULE_BINDINGS,
);
