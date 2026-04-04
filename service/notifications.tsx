import Notifd from 'gi://AstalNotifd'
import { createState } from 'ags'
    
export const [notifications, setNotifications] = createState<Notifd.Notification[]>([])

const notifd = Notifd.get_default()
notifd.connect('notified', (_, id, isPopup) => {
    const notification = notifd.get_notification(id)
    if (notification === null) {
        return
    }

    setNotifications([...notifications.get(), notification])
    console.log(`Notifications: ${notifications.get().length}`)

    console.log('=== NEW NOTIFICATION ===')
    console.log(`App: ${notification.appName}`)
    console.log(`Title: ${notification.summary}`)
    console.log(`Body: ${notification.body}`)
    console.log(`Icon: ${notification.appIcon}`)
    console.log(`ID: ${notification.id}`)
    console.log(`Is Popup: ${isPopup}`)
})
notifd.connect('resolved', (_, id, reason) => {
    setNotifications(notifications.get().filter(notification => notification.id !== id))
    console.log('=== NOTIFICATION RESOLVED ===')
    console.log(`ID: ${id}`)
    console.log(`Reason: ${reason}`)
})