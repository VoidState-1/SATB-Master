import { Plus, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { CommitField } from "./CommitField";

export interface TimingRow {
  id: string;
  tick: number;
  value: string;
  protected: boolean;
  onValue(value: string): void;
  onDelete(): void;
}

export function TimingSection({
  title,
  onAdd,
  rows,
}: {
  title: string;
  onAdd(): void;
  rows: TimingRow[];
}) {
  return (
    <section className="property-section timing-section">
      <header>
        <span>{title}</span>
        <IconButton
          label={`在播放头添加${title}`}
          icon={<Plus />}
          onClick={onAdd}
        />
      </header>
      {rows.map((row) => (
        <div className="timing-row" key={row.id}>
          <small>tick {row.tick}</small>
          <CommitField value={row.value} onCommit={row.onValue} />
          <IconButton
            label={`删除${title}事件`}
            icon={<Trash2 />}
            disabled={row.protected}
            onClick={row.onDelete}
          />
        </div>
      ))}
    </section>
  );
}
