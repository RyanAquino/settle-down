Pod::Spec.new do |s|
  s.name = 'ReceiptReminderCalendar'
  s.version = '1.0.0'
  s.summary = 'One-shot saved receipt reminders in the current local time zone.'
  s.homepage = 'https://github.com/RyanAquino/settle-down'
  s.author = 'Ryan Aquino'
  s.license = 'UNLICENSED'
  s.platform = :ios, '16.4'
  s.source = { :git => 'https://github.com/RyanAquino/settle-down.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.framework = 'UserNotifications'
  s.source_files = '*.swift'
end
