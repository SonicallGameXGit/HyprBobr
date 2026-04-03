import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createPoll } from "ags/time"

export default function Bar(gdkmonitor: Gdk.Monitor) {
    const time = createPoll("", 1000, "date")
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

    const result = (
        <window
            visible
            name="hyprbobr-bar"
            namespace="hyprbobr-bar"
            class="Bar"
            layer={Astal.Layer.BOTTOM}
            gdkmonitor={gdkmonitor}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={TOP | LEFT | RIGHT}
            application={app}
            // margin={8}
            // marginBottom={32}
        >
            <centerbox cssName="centerbox">
                <button $type="start" halign={Gtk.Align.START}>
                    <label label="Welcome to AGS!" />
                </button>
                <box $type="center" />
                <menubutton $type="end" hexpand halign={Gtk.Align.END}>
                    <label label={time} />
                    <popover>
                        <Gtk.Calendar />
                    </popover>
                </menubutton>
            </centerbox>
        </window>
    )
    return result
}
