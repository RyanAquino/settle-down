import ExpoModulesCore
import UserNotifications

public final class ReceiptReminderCalendarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReceiptReminderCalendar")

    AsyncFunction("schedule") { (identifier: String, calendarDate: String, title: String,
                                 body: String, data: [String: String]) async throws in
      let date = calendarDate.split(separator: "-")
      guard date.count == 3, let year = Int(date[0]), let month = Int(date[1]), let day = Int(date[2]) else {
        throw NSError(domain: "ReceiptReminderCalendar", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Invalid receipt reminder date."])
      }

      // Expo's calendar trigger pins the calendar's time zone at creation. Persist an
      // autoupdating zone so iOS itself keeps 9 AM local after travel while the app is closed.
      var calendar = Calendar(identifier: .gregorian)
      calendar.timeZone = .autoupdatingCurrent
      let components = DateComponents(calendar: calendar, year: year, month: month, day: day,
                                      hour: 9, minute: 0, second: 0)
      let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      content.userInfo = data
      try await UNUserNotificationCenter.current().add(
        UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
      )
    }
  }
}
