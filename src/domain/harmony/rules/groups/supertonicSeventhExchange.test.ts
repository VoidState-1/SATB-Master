import { describe, expect, it } from "vitest";
import { compileScoreText } from "../../../scoreText";
import { applyHarmonyInference, checkHarmony, inferChords } from "../../index";
import type { ProjectDocument, VoiceId } from "../../../project/types";

const exchange = ["F5 F5", "A4 A4", "C4 D4", "D3 C3"];
function score(voices = exchange, chords = "SII7 SII2", key = "C major") {
  const parts = [...voices, chords].map((line, index) => {
    const notes = line.split(" ").map(pitch => `${pitch}/4`).join(" ");
    return line && ` ${["S", "A", "T", "B", "H"][index]}: | ${notes} |`;
  });
  return compileScoreText(`satb 1
key ${key}
meter 2/4
bars 1..1 {
${parts.join("\n")}
}`).project;
}
function atExchange(project: ProjectDocument, voice: VoiceId = "tenor") {
  return checkHarmony(project).diagnostics.filter(item => item.ruleId === "resolution.chord-seventh" &&
    item.tick === project.ppq && item.voiceIds.includes(voice));
}

describe("下属七和弦重新排列时的根音和七音", () => {
  it("男高七音与低音根音互换，给定和弦及盲推均指出原七音声部", () => {
    const bare = score(exchange, "");
    const blind = applyHarmonyInference(bare, { chordInference: inferChords(bare) }, { mode: "replace-unlocked" }).project;
    for (const project of [score(), blind]) {
      expect(atExchange(project)).toMatchObject([{severity:"warning", title:"下属七和弦的七音与根音互换", voiceIds:["tenor"]}]);
    }
    expect(atExchange(bare)).toHaveLength(0);
  });
  it("降B大调属前功能相同，一转位不动低音时内声和女高也能发生互换", () => {
    const project = score(["Bb4 C5","G4 G4","C4 Bb3","Eb3 Eb3"],"SII65 SII65","Bb major");
    expect(atExchange(project,"soprano")).toMatchObject([{severity:"warning",title:"下属七和弦的七音与根音互换"}]);
  });
  it.each([
    ["下属七的七音与五音交换", ["A4 C5","D4 D4","C4 A3","F2 F2"],"SII65 SII65"],
    ["七音由低音引入，起点是下属二级三和弦", ["F5 F5","A4 A4","D4 D4","D3 C3"],"SII SII2"],
    ["七音与三音交换，非根音接手", ["A4 A4","F4 C4","C4 F4","D3 D3"],"SII7 SII7"],
    ["原五音声部接走七音，同时原根音移至五音", ["A4 C5","F4 F4","C4 D4","D3 A2"],"SII7 SII43"],
    ["两端声部没有写全和弦", ["A4 F4","F4 F4","C4 D4","D3 C3"],"SII7 SII2"],
    ["实际低音与标注不合", exchange, "SII65 SII2"],
  ] as const)("%s 时保留原有判断", (_label, notes, harmony) => {
    expect(atExchange(score([...notes], harmony))).toHaveLength(0);
  });
  it("人工作出的乐句边界切断原七音义务的声部证据", () => {
    const project = score();
    project.structure.phraseBoundaries.push({id:"phrase",tick:project.ppq,source:"manual",confidence:"certain"});
    expect(atExchange(project)).toHaveLength(0);
  });
});
