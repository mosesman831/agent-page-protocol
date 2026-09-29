/**
 * Classwork demo — extra LMS pages: to-do list, due-date calendar,
 * materials library, notifications, archived classes, help.
 */

import {
  str,
  num,
  datetime,
  bool,
  obj,
  arr,
  table,
  markdown,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';

const GC = (o, slug) => `${o}/app/gc/${slug}`;
const crumbs = (o, label, slug) => ({
  breadcrumb: [
    { label: 'Classroom', url: GC(o, 'home') },
    { label, url: GC(o, slug) },
  ],
});

export function buildGcExtraPages(origin) {
  const pages = new Map();

  /* ---------- to-do ---------- */
  pages.set(
    'todo',
    doc({
      id: 'gc_todo',
      origin,
      path: '/app/gc/todo',
      title: 'To-do',
      version: 'gc-todo-1',
      state: {
        assigned: table(
          {
            work: 'string',
            class: 'string',
            due: 'datetime',
            status: 'enum',
          },
          [
            [
              'Essay: chapters 12-15',
              'English Literature 10',
              '2026-10-01T23:59:00+00:00',
              'assigned',
            ],
            ['Cell respiration quiz', 'Biology', '2026-10-02T09:00:00+00:00', 'assigned'],
            ['Quadratic worksheet', 'Algebra II', '2026-10-03T15:00:00+00:00', 'missing'],
            ['Lab safety pledge', 'Chemistry', '2026-10-06T08:30:00+00:00', 'assigned'],
          ],
          'Assigned & due',
        ),
        done: table(
          { work: 'string', class: 'string', turned_in: 'datetime', grade: 'number' },
          [
            ['Poetry analysis', 'English Literature 10', '2026-09-24T20:12:00+00:00', 92],
            ['Photosynthesis lab', 'Biology', '2026-09-22T11:04:00+00:00', 88],
          ],
          'Recently done',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'assigned',
            state_path: 'assigned',
            layout: 'table',
            label: 'To do',
            columns: [
              { key: 'work', label: 'Work' },
              { key: 'class', label: 'Class' },
              { key: 'due', label: 'Due', format: 'datetime' },
              { key: 'status', label: 'Status', align: 'center' },
            ],
            sortable_by: ['due'],
          },
          {
            id: 'done',
            state_path: 'done',
            layout: 'table',
            label: 'Done',
            columns: [
              { key: 'work', label: 'Work' },
              { key: 'class', label: 'Class' },
              { key: 'turned_in', label: 'Turned in', format: 'datetime' },
              { key: 'grade', label: 'Grade', format: 'number', align: 'right' },
            ],
          },
        ],
      },
      actions: {
        open_todo: navAction('Open first item', GC(origin, 'assignment')),
      },
      navigation: crumbs(origin, 'To-do', 'todo'),
    }),
  );

  /* ---------- calendar ---------- */
  pages.set(
    'calendar',
    doc({
      id: 'gc_calendar',
      origin,
      path: '/app/gc/calendar',
      title: 'Due dates',
      version: 'gc-cal-1',
      state: {
        month: str('October 2026', 'Viewing'),
        days: arr(
          [
            { d: '2026-10-01', items: 1 },
            { d: '2026-10-02', items: 2 },
            { d: '2026-10-03', items: 1 },
            { d: '2026-10-06', items: 1 },
            { d: '2026-10-09', items: 3 },
            { d: '2026-10-14', items: 1 },
            { d: '2026-10-21', items: 2 },
            { d: '2026-10-30', items: 1 },
          ].map((r) => obj({ date: str(r.d), items: num(r.items, { label: 'Due' }) })),
          'Days with work due',
        ),
        upcoming: table(
          { date: 'string', work: 'string', class: 'string' },
          [
            ['Thu 1 Oct', 'Essay: chapters 12-15', 'English Literature 10'],
            ['Fri 2 Oct', 'Cell respiration quiz', 'Biology'],
            ['Fri 2 Oct', 'Graphing drill', 'Algebra II'],
            ['Sat 3 Oct', 'Quadratic worksheet', 'Algebra II'],
            ['Tue 6 Oct', 'Lab safety pledge', 'Chemistry'],
          ],
          'Next up',
        ),
      },
      present: {
        layout: 'list',
        sections: [{ id: 'up', state_path: 'upcoming', layout: 'table', label: 'Next up' }],
        components: {
          cal: { type: 'calendar', state_path: 'days', label: 'October 2026 — work due per day' },
        },
      },
      actions: {},
      navigation: crumbs(origin, 'Calendar', 'calendar'),
    }),
  );

  /* ---------- materials ---------- */
  pages.set(
    'materials',
    doc({
      id: 'gc_materials',
      origin,
      path: '/app/gc/materials',
      title: 'Materials — English Literature 10',
      version: 'gc-mat-1',
      state: {
        library: table(
          {
            resource: 'string',
            topic: 'enum',
            type: 'enum',
            added: 'datetime',
            size: 'string',
          },
          [
            ['Course syllabus', 'essays', 'document', '2026-09-02T08:00:00+00:00', 'PDF · 340 KB'],
            [
              'Gothic fiction reading list',
              'essays',
              'document',
              '2026-09-05T12:00:00+00:00',
              'PDF · 88 KB',
            ],
            ['Essay rubric v2', 'essays', 'document', '2026-09-10T09:00:00+00:00', 'PDF · 120 KB'],
            ['Ch. 12-15 audio', 'readings', 'media', '2026-09-18T15:00:00+00:00', 'MP3 · 41 MB'],
            ['Style guide', 'reference', 'link', '2026-09-20T10:00:00+00:00', '—'],
          ],
          'Class materials',
        ),
        note: markdown(
          'Materials are view-only for students. Teachers can attach files to any classwork post.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'lib',
            state_path: 'library',
            layout: 'table',
            label: 'Library',
            columns: [
              { key: 'resource', label: 'Resource' },
              { key: 'topic', label: 'Topic' },
              { key: 'type', label: 'Type', align: 'center' },
              { key: 'added', label: 'Added', format: 'datetime' },
              { key: 'size', label: 'Size', align: 'right' },
            ],
            sortable_by: ['added'],
            filterable_by: ['topic', 'type'],
          },
          { id: 'note', state_path: 'note', layout: 'detail', label: 'About' },
        ],
      },
      actions: {
        back_class: navAction('Back to class', GC(origin, 'stream')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Classroom', url: GC(origin, 'home') },
          { label: 'English Literature 10', url: GC(origin, 'stream') },
          { label: 'Materials', url: GC(origin, 'materials') },
        ],
      },
    }),
  );

  /* ---------- notifications ---------- */
  pages.set(
    'notifications',
    doc({
      id: 'gc_notifications',
      origin,
      path: '/app/gc/notifications',
      title: 'Notifications',
      version: 'gc-notif-1',
      state: {
        recent: arr(
          [
            obj({
              text: str('Ms Rowan posted "Essay: chapters 12-15"'),
              when: datetime('2026-09-28T14:30:00+00:00'),
              read: bool(false),
            }),
            obj({
              text: str('Your grade was returned for Poetry analysis'),
              when: datetime('2026-09-26T11:02:00+00:00'),
              read: bool(true),
            }),
            obj({
              text: str('Dr Chen posted "Cell respiration quiz"'),
              when: datetime('2026-09-25T09:15:00+00:00'),
              read: bool(true),
            }),
          ],
          'Recent',
        ),
        settings: obj(
          {
            email_due_reminders: bool(true, 'Due-date reminders'),
            email_returned_grades: bool(true, 'Returned grades'),
            email_comments: bool(false, 'Class comments'),
            push_everything: bool(false, 'Push notifications'),
          },
          'Email & push settings',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'recent', state_path: 'recent', layout: 'list', label: 'Recent' },
          { id: 'settings', state_path: 'settings', layout: 'detail', label: 'Settings' },
        ],
      },
      actions: {
        toggle_notify: action('Save notification settings', 'mutate', 'safe', {
          input: {
            email_due_reminders: { type: 'boolean', description: 'Due-date reminders' },
            email_returned_grades: { type: 'boolean', description: 'Returned grades' },
            email_comments: { type: 'boolean', description: 'Class comments' },
            push_everything: { type: 'boolean', description: 'Push notifications' },
          },
          output: { state_diff: true, changes: ['/state/settings'] },
          idempotent: true,
        }),
      },
      navigation: crumbs(origin, 'Notifications', 'notifications'),
    }),
  );

  /* ---------- archived ---------- */
  pages.set(
    'archived',
    doc({
      id: 'gc_archived',
      origin,
      path: '/app/gc/archived',
      title: 'Archived classes',
      version: 'gc-arch-1',
      state: {
        archived: table(
          {
            class: 'string',
            section: 'string',
            teacher: 'string',
            archived_on: 'datetime',
            grade: 'string',
          },
          [
            ['English Literature 9', 'Period 2', 'Ms Rowan', '2026-06-20T16:00:00+00:00', 'A'],
            ['Algebra I', 'Period 5', 'Mr Adeyemi', '2026-06-20T16:00:00+00:00', 'A-'],
            ['World History', 'Period 3', 'Ms Delacroix', '2026-06-19T16:00:00+00:00', 'B+'],
          ],
          'Archived',
        ),
        note: markdown(
          'Archived classes are read-only — you keep your grades and materials, but nothing new posts.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'arch',
            state_path: 'archived',
            layout: 'table',
            label: 'Archived classes',
            columns: [
              { key: 'class', label: 'Class' },
              { key: 'teacher', label: 'Teacher' },
              { key: 'archived_on', label: 'Archived', format: 'datetime' },
              { key: 'grade', label: 'Final grade', align: 'center' },
            ],
          },
          { id: 'note', state_path: 'note', layout: 'detail', label: 'About archiving' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Archived', 'archived'),
    }),
  );

  /* ---------- help ---------- */
  pages.set(
    'help',
    doc({
      id: 'gc_help',
      origin,
      path: '/app/gc/help',
      title: 'Classroom help',
      version: 'gc-help-1',
      state: {
        faq: markdown(
          [
            '**How do I join a class?** Ask your teacher for the class code, then use "Join a class" on your dashboard.',
            '**When is work due?** Check To-do or Calendar — both list every deadline across your classes.',
            '**Can I edit after turning in?** Yes, until the due date — unsubmit, change, resubmit.',
            '**Who sees my comments?** Class comments are visible to everyone in the class. Private comments go only to your teacher.',
            '**Is this real?** This is a demo classroom for the Agent Page Protocol — no real school, no real grades.',
          ].join('\n\n'),
          'Frequently asked',
        ),
        stats: obj(
          {
            classes: num(3, { label: 'Enrolled classes' }),
            open_work: num(4, { label: 'Open assignments' }),
            avg_grade: num(90, { label: 'Average grade (%)' }),
          },
          'Your term at a glance',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'faq', state_path: 'faq', layout: 'detail', label: 'FAQ' },
          { id: 'stats', state_path: 'stats', layout: 'detail', label: 'Your term' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Help', 'help'),
    }),
  );

  return pages;
}
