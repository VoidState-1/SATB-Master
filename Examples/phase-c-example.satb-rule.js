SATB_RULE.register({
  manifest: {
    apiVersion: 1,
    packageId: "org.satbmaster.example",
    version: "1.0.0",
    rules: [
      {
        id: "long-soprano-note",
        label: "女高音超长持续音（示例）",
        description: "演示外置规则读取只读工程上下文，并对超过四拍的女高音音符给出建议。",
        group: "custom",
        defaultSeverity: "suggestion",
        dependencyScope: "note",
      },
    ],
  },
  rules: [
    {
      id: "long-soprano-note",
      evaluate(context, config) {
        const thresholdBeats =
          typeof config.thresholdBeats === "number"
            ? Math.max(1, config.thresholdBeats)
            : 4;
        const thresholdTicks = context.project.ppq * thresholdBeats;
        const soprano = context.project.satbTracks.find(
          (track) => track.id === "soprano",
        );
        if (!soprano) return [];
        return soprano.notes
          .filter((note) => note.durationTicks > thresholdTicks)
          .map((note) => ({
            tick: note.startTick,
            endTick: note.startTick + note.durationTicks,
            voiceIds: ["soprano"],
            noteIds: [note.id],
            chordIds: [],
            title: "女高音持续时间较长",
            message: `该音符持续超过 ${thresholdBeats} 拍；这是一个无害的外置规则示例。`,
            messageKey: "long-soprano-note",
            params: { thresholdBeats },
            evidence: [
              {
                kind: "note",
                id: note.id,
                label: "持续 tick",
                value: String(note.durationTicks),
              },
            ],
            confidence: 1,
          }));
      },
    },
  ],
});
