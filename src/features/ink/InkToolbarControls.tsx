import { Icon } from "../../components/Icons";
import { INK_COLORS, PEN_WIDTHS, type InkToolState } from "./inkGeometry";

interface InkToolbarControlsProps {
  value: InkToolState;
  onChange: (value: InkToolState) => void;
}

export default function InkToolbarControls({ value, onChange }: InkToolbarControlsProps) {
  const setTool = (tool: InkToolState["activeTool"]) => {
    onChange({ ...value, activeTool: value.activeTool === tool ? "none" : tool });
  };

  return (
    <span className="ink-toolbar">
      <button
        className={`icon-button ${value.activeTool === "pen" ? "active" : ""}`}
        onClick={() => setTool("pen")}
        title="Pen"
        aria-label="Pen"
      >
        <Icon name="pen" />
      </button>
      <button
        className={`icon-button ${value.activeTool === "eraser" ? "active" : ""}`}
        onClick={() => setTool("eraser")}
        title="Eraser"
        aria-label="Eraser"
      >
        <Icon name="eraser" />
      </button>

      {value.activeTool === "pen" && (
        <span className="ink-popover" aria-label="Pen settings">
          <span className="ink-swatches">
            {INK_COLORS.map((color) => (
              <button
                key={color}
                className={`ink-swatch ${value.color === color ? "active" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => onChange({ ...value, color })}
                title={color}
                aria-label={`Pen color ${color}`}
              />
            ))}
          </span>
          <select
            value={value.penWidth}
            onChange={(event) => onChange({ ...value, penWidth: Number(event.target.value) })}
            aria-label="Pen width"
          >
            {PEN_WIDTHS.map((width) => (
              <option key={width} value={width}>{width}px</option>
            ))}
          </select>
        </span>
      )}

    </span>
  );
}
