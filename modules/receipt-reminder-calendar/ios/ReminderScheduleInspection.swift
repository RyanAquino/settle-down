#if RECEIPT_REMINDER_VERIFICATION && targetEnvironment(simulator)
import Foundation
import UserNotifications

// Read usernotificationsd's persisted requests, including requests for drafts already removed.
// Keep the accelerated preview (which has a random identifier) out of the production counts.
enum ReminderScheduleInspection {
  static func read(createdAt: [String: Double]) async -> [String] {
    let requests = await UNUserNotificationCenter.current().pendingNotificationRequests()
    let elapsed = requests.filter { $0.identifier.hasPrefix("receipt-reminder:elapsed:") }
    let mornings = requests.filter { $0.identifier.hasPrefix("receipt-reminder:morning:") }
    var lines = ["Elapsed requests: \(elapsed.count)", "Morning requests: \(mornings.count)"]

    for request in elapsed {
      let id = String(request.identifier.dropFirst("receipt-reminder:elapsed:".count))
      guard let saved = createdAt[id],
            let submitted = request.content.userInfo["verifySubmittedAt"] as? NSNumber,
            let trigger = request.trigger as? UNTimeIntervalNotificationTrigger,
            !trigger.repeats else {
        lines.append("Elapsed request has no matching draft or one-shot interval")
        continue
      }
      // Expo converts its absolute DATE deadline to a remaining interval when registering on iOS.
      let minutes = (submitted.doubleValue - saved) / 60_000 + trigger.timeInterval / 60
      lines.append("Elapsed: \(Int(minutes.rounded())) minutes after save")
    }

    for request in mornings {
      guard let trigger = request.trigger as? UNCalendarNotificationTrigger, !trigger.repeats,
            let fire = trigger.nextTriggerDate(),
            let raw = request.content.userInfo["draftIds"] as? String,
            let ids = try? JSONDecoder().decode([String].self, from: Data(raw.utf8)),
            !ids.isEmpty, Set(ids).count == ids.count else {
        lines.append("Morning request has no upcoming one-shot date or receipt IDs")
        continue
      }
      let calendar = Calendar.current
      let offsets = ids.compactMap { id -> Int? in
        guard let saved = createdAt[id] else { return nil }
        let date = Date(timeIntervalSince1970: saved / 1000)
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: date),
                                       to: calendar.startOfDay(for: fire)).day
      }
      if offsets.count == ids.count, let offset = offsets.first, Set(offsets).count == 1 {
        let members = ids.count == 1 ? "1 receipt" : "\(ids.count) receipts"
        let days = offset < 0 ? String(offset) : "+\(offset)"
        lines.append("Morning: \(members), day \(days) at \(clock(fire, in: calendar.timeZone))")
      } else {
        lines.append("Morning request includes missing drafts or mixed creation days")
      }
      // Resolve the returned fields in each proposed device zone. An archived explicit calendar
      // or time zone takes precedence, so a pinned Tokyo request reads 08:00 in Singapore.
      let fields = trigger.dateComponents
      for (city, zoneID) in [("Tokyo", "Asia/Tokyo"), ("Singapore", "Asia/Singapore")] {
        guard let zone = TimeZone(identifier: zoneID), let utc = TimeZone(secondsFromGMT: 0) else { continue }
        var resolver = fields.calendar ?? calendar
        resolver.timeZone = fields.timeZone ?? fields.calendar?.timeZone ?? zone
        if let date = resolver.date(from: fields) {
          lines.append("\(city) \(clock(date, in: zone)) (\(clock(date, in: utc)) UTC)")
        }
      }
    }
    return lines
  }

  private static func clock(_ date: Date, in zone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    return String(format: "%02d:%02d", calendar.component(.hour, from: date),
                  calendar.component(.minute, from: date))
  }
}
#endif
