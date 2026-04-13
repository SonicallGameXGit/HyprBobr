import Notifd from 'gi://AstalNotifd'
import { createState } from 'ags'
    
export const [notifications, setNotifications] = createState<Notifd.Notification[]>([])

const notifd = Notifd.get_default()
notifd.connect('notified', (_, id, __) => {
    const notification = notifd.get_notification(id)
    if (notification === null) {
        return
    }
    setNotifications([...notifications.peek(), notification])
})
notifd.connect('resolved', (_, id, __) => {
    setNotifications(notifications.peek().filter(notification => notification.id !== id))
})