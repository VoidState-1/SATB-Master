import { defineRuleCollection } from "../defineRule";
import { BASIC_TEACHING_RULES } from "./basicTeaching";
import { CHORD_RULES } from "./chord";
import { CONNECTION_RULES } from "./connection";
import { FUNCTION_RULES } from "./function";
import { MELODY_RULES } from "./melody";
import { NONCHORD_RULES } from "./nonchord";
import { RHYTHM_CADENCE_TONALITY_RULES } from "./rhythmCadenceTonality";
import { SPECIALIZED_CONNECTION_RULES } from "./specializedConnections";
import { STATEFUL_RULES } from "./stateful";
import { VOICE_RULES } from "./voice";
import { VOICE_LEADING_RULES } from "./voiceLeading";

export const BUILTIN_HARMONY_RULES = defineRuleCollection(
  VOICE_RULES,
  VOICE_LEADING_RULES,
  MELODY_RULES,
  CHORD_RULES,
  NONCHORD_RULES,
  CONNECTION_RULES,
  FUNCTION_RULES,
  RHYTHM_CADENCE_TONALITY_RULES,
  BASIC_TEACHING_RULES,
  SPECIALIZED_CONNECTION_RULES,
  STATEFUL_RULES,
);
