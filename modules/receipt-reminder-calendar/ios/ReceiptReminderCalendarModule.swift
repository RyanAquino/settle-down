import ExpoModulesCore
import UserNotifications

public final class ReceiptReminderCalendarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReceiptReminderCalendar")

    #if RECEIPT_REMINDER_VERIFICATION && targetEnvironment(simulator)
    AsyncFunction("inspectSchedule") { (createdAt: [String: Double]) async -> [String] in
      await ReminderScheduleInspection.read(createdAt: createdAt)
    }
    #endif

    AsyncFunction("schedule") { (identifier: String, calendarDate: String, title: String,
                                 body: String, data: [String: String]) async throws in
      let date = calendarDate.split(separator: "-")
      guard date.count == 3, let year = Int(date[0]), let month = Int(date[1]), let day = Int(date[2]) else {
        throw NSError(domain: "ReceiptReminderCalendar", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Invalid receipt reminder date."])
      }

      // usernotificationsd archives the calendar's current zone even if it is autoupdating.
      // Pass only the date fields in the user's calendar so the system resolves 9 AM locally.
      let gregorian = Calendar(identifier: .gregorian)
      guard let localDate = gregorian.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) else {
        throw NSError(domain: "ReceiptReminderCalendar", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Invalid receipt reminder date."])
      }
      var components = Calendar.current.dateComponents([.era, .year, .month, .day], from: localDate)
      components.hour = 9
      components.minute = 0
      components.second = 0
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
