import { GlassSelect } from './GlassSelect';

/** Keep the real select for the Web Serial engine while drawing a custom,
 * portalled translucent dropdown outside the blurred top bar. */
export function BaudRatePicker() {
  return <GlassSelect selectId="serialBaud" caption="Serial speed / baud" className="glass-select--baud"
    nativeChildren={<select id="serialBaud" defaultValue="115200" className="glass-select__native" tabIndex={-1} aria-hidden="true" aria-label="Serial baud rate">
      <option value="9600">9600</option>
      <option value="57600">57600</option>
      <option value="115200">115200</option>
    </select>} />;
}
