package com.ryan.aquino.settledown.reminders;

import android.content.Context;
import android.content.Intent;

import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import expo.modules.notifications.notifications.model.NotificationRequest;
import expo.modules.notifications.notifications.triggers.DateTrigger;
import expo.modules.notifications.service.NotificationsService;
import expo.modules.notifications.service.interfaces.SchedulingDelegate;

/** Keeps Expo's one-shot morning alarms at 09:00 local time even while JS is stopped. */
public final class ReceiptReminderNotificationsService extends NotificationsService {
  private static final Pattern MORNING_ID =
      Pattern.compile("receipt-reminder:morning:([0-9]{4})-([0-9]{2})-([0-9]{2})");
  private static final Object REQUESTS_LOCK = new Object();

  @Override
  public void handleIntent(Context context, Intent intent) {
    // Expo dispatches each broadcast on its own thread. Rewriting an old request must never
    // race a cancellation or a change to the group/count coming from JS.
    synchronized (REQUESTS_LOCK) {
      if (Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())) {
        String zoneId = intent.getStringExtra("time-zone");
        TimeZone zone = zoneId == null ? TimeZone.getDefault() : TimeZone.getTimeZone(zoneId);
        refreshMorningAlarms(getSchedulingDelegate(context), zone, System.currentTimeMillis());
      } else {
        super.handleIntent(context, intent);
      }
    }
  }

  @Override
  public void onSetupScheduledNotifications(Context context, Intent intent) {
    // The device may have been off when it moved to another time zone.
    refreshMorningAlarms(getSchedulingDelegate(context), TimeZone.getDefault(), System.currentTimeMillis());
    super.onSetupScheduledNotifications(context, intent);
  }

  @Override
  public void onNotificationTriggered(Context context, Intent intent) {
    String id = intent.getStringExtra(IDENTIFIER_KEY);
    if (id != null && MORNING_ID.matcher(id).matches()) {
      SchedulingDelegate scheduler = getSchedulingDelegate(context);
      NotificationRequest request = scheduler.getScheduledNotification(id);
      if (request == null) return;
      if (!(request.getTrigger() instanceof DateTrigger)) {
        super.onNotificationTriggered(context, intent);
        return;
      }
      // A broadcast for the old alarm might already be queued when the system changes zone.
      long now = System.currentTimeMillis();
      long due = morningTime(id, TimeZone.getDefault());
      DateTrigger trigger = (DateTrigger) request.getTrigger();
      if (due != trigger.getTimestamp()) {
        moveMorning(scheduler, request, trigger, due, now);
        return;
      }
      if (due > now) return;
    }
    super.onNotificationTriggered(context, intent);
  }

  static void refreshMorningAlarms(SchedulingDelegate scheduler, TimeZone zone, long now) {
    for (NotificationRequest request : scheduler.getAllScheduledNotifications()) {
      long due = morningTime(request.getIdentifier(), zone);
      if (due < 0 || !(request.getTrigger() instanceof DateTrigger)) continue;
      moveMorning(scheduler, request, (DateTrigger) request.getTrigger(), due, now);
    }
  }

  private static long morningTime(String id, TimeZone zone) {
    Matcher date = MORNING_ID.matcher(id);
    if (!date.matches()) return -1;
    GregorianCalendar morning = new GregorianCalendar(zone);
    morning.clear();
    morning.set(Integer.parseInt(date.group(1)), Integer.parseInt(date.group(2)) - 1,
        Integer.parseInt(date.group(3)), 9, 0);
    return morning.getTimeInMillis();
  }

  private static void moveMorning(SchedulingDelegate scheduler, NotificationRequest request,
      DateTrigger trigger, long due, long now) {
    if (due <= now) {
      scheduler.removeScheduledNotifications(Collections.singletonList(request.getIdentifier()));
    } else if (due != trigger.getTimestamp()) {
      scheduler.scheduleNotification(new NotificationRequest(
          request.getIdentifier(), request.getContent(),
          new DateTrigger(trigger.getChannelId(), due, trigger.getAlarmClock())));
    }
  }
}
