import app from 'ags/gtk4/app'
import style from './style.scss'
import Bar from './widget/Bar'
import './service/notifications'
import Notifications from './widget/Notifications'
import VolumeIndicator from './widget/VolumeIndicator'

app.start({
    css: style,
    main() {
        const monitors = app.get_monitors()
        monitors.map(Bar)
        Notifications()
        VolumeIndicator()
    },
})