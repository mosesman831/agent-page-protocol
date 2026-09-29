/**
 * Google Classroom clone demo — APP page manifests:
 * dashboard → class stream → classwork → assignment detail → grades → people.
 */

import {
  str,
  num,
  datetime,
  enumN,
  obj,
  arr,
  table,
  file,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';

const GC = (o, slug) => `${o}/app/gc/${slug}`;

function classCard({ id, name, section, teacher, room, next }) {
  return obj(
    {
      id: str(id),
      name: str(name, 'Class'),
      section: str(section, 'Section'),
      teacher: str(teacher, 'Teacher'),
      room: str(room, 'Room'),
      next_due: str(next, 'Next due'),
    },
    name,
  );
}

export function buildGcPages(origin) {
  const pages = new Map();

  /* ---------- 1. dashboard ---------- */
  pages.set(
    'home',
    doc({
      id: 'gc_home',
      origin,
      path: '/app/gc/home',
      title: 'Classroom - Your classes',
      version: 'gc-home-1',
      state: {
        user: obj(
          {
            name: str('Ada Osei', 'Signed in as'),
            role: enumN('student', ['student', 'teacher'], undefined, 'Role'),
            email: str('ada.osei@school.edu'),
          },
          'Account',
        ),
        classes: arr(
          [
            classCard({
              id: 'c-eng10',
              name: 'English Literature 10',
              section: 'Period 2',
              teacher: 'Ms Rowan',
              room: 'B-204',
              next: 'Essay ch.12-15 - Thu',
            }),
            classCard({
              id: 'c-bio',
              name: 'Biology',
              section: 'Period 4',
              teacher: 'Dr Chen',
              room: 'Lab 3',
              next: 'Cell respiration quiz - Fri',
            }),
            classCard({
              id: 'c-math',
              name: 'Algebra II',
              section: 'Period 1',
              teacher: 'Mr Adeyemi',
              room: 'M-118',
              next: 'Problem set 9 - Wed',
            }),
            classCard({
              id: 'c-hist',
              name: 'Modern History',
              section: 'Period 5',
              teacher: 'Mrs Ibekwe',
              room: 'H-02',
              next: 'Cold War source pack - Mon',
            }),
          ],
          'Your classes',
        ),
        todo: table(
          { class: 'string', assignment: 'string', due: 'datetime', status: 'enum' },
          [
            ['Algebra II', 'Problem set 9', '2026-09-30T23:59:00+00:00', 'assigned'],
            ['Biology', 'Cell respiration quiz', '2026-10-02T09:00:00+00:00', 'assigned'],
            [
              'English Literature 10',
              'Essay: chapters 12-15',
              '2026-10-01T23:59:00+00:00',
              'in_progress',
            ],
          ],
          'To do',
        ),
      },
      present: {
        layout: 'dashboard',
        sections: [
          {
            id: 'classes',
            state_path: 'classes',
            layout: 'grid',
            columns: [
              { key: 'section', label: 'Section' },
              { key: 'teacher', label: 'Teacher' },
              { key: 'room', label: 'Room' },
              { key: 'next', label: 'Next up' },
            ],
            item_key: 'id',
            primary_action: 'open_class',
            label: 'Classes',
          },
          { id: 'todo', state_path: 'todo', layout: 'table', label: 'Due soon' },
        ],
      },
      actions: {
        open_class: navAction('Open class', GC(origin, 'stream')),
        join_class: action('Join a class', 'mutate', 'safe', {
          input: {
            class_code: {
              type: 'string',
              required: true,
              min_length: 5,
              max_length: 8,
              description: 'Class code from your teacher',
            },
          },
          output: { state_diff: true, changes: ['/state/classes'] },
          idempotent: true,
        }),
      },
      navigation: { breadcrumb: [{ label: 'Classroom', url: GC(origin, 'home') }] },
    }),
  );

  /* ---------- 2. stream ---------- */
  pages.set(
    'stream',
    doc({
      id: 'gc_stream',
      origin,
      path: '/app/gc/stream',
      title: 'English Literature 10 - Stream',
      version: 'gc-stream-1',
      state: {
        class_info: obj(
          {
            name: str('English Literature 10'),
            section: str('Period 2'),
            teacher: str('Ms Rowan'),
            class_code: str('eng10-rwn', 'Class code'),
            room: str('B-204'),
          },
          'Class',
        ),
        upcoming: arr(
          [
            obj(
              {
                title: str('Essay: chapters 12-15'),
                due: datetime('2026-10-01T23:59:00+00:00', 'Due'),
              },
              'Essay',
            ),
          ],
          'Upcoming',
        ),
        posts: arr(
          [
            obj(
              {
                id: str('p-1042'),
                author: str('Ms Rowan', 'Posted by'),
                posted: datetime('2026-09-26T08:15:00+00:00', 'Posted'),
                kind: enumN(
                  'announcement',
                  ['announcement', 'assignment', 'material'],
                  undefined,
                  'Type',
                ),
                body: str(
                  'Reminder: seminar groups for chapters 16-18 are posted. Check your group before Thursday.',
                  'Text',
                ),
                attachments: arr([], 'Attachments'),
                comments: num(2, { label: 'Class comments' }),
              },
              'Reminder: seminar groups',
            ),
            obj(
              {
                id: str('p-1040'),
                author: str('Ms Rowan', 'Posted by'),
                posted: datetime('2026-09-24T14:02:00+00:00', 'Posted'),
                kind: enumN(
                  'assignment',
                  ['announcement', 'assignment', 'material'],
                  undefined,
                  'Type',
                ),
                body: str(
                  'New assignment: analytical essay on chapters 12-15. 800-1000 words, due Thursday.',
                  'Text',
                ),
                attachments: arr(
                  [
                    file(
                      `${origin}/demo/files/essay-brief.pdf`,
                      'essay-brief.pdf',
                      'application/pdf',
                    ),
                  ],
                  'Attachments',
                ),
                comments: num(5, { label: 'Class comments' }),
              },
              'Essay: chapters 12-15',
            ),
            obj(
              {
                id: str('p-1031'),
                author: str('Ms Rowan', 'Posted by'),
                posted: datetime('2026-09-22T09:30:00+00:00', 'Posted'),
                kind: enumN(
                  'material',
                  ['announcement', 'assignment', 'material'],
                  undefined,
                  'Type',
                ),
                body: str(
                  'Reading: chapter 15 symbolism notes and glossary added to Classwork > Materials.',
                  'Text',
                ),
                attachments: arr(
                  [
                    file(
                      `${origin}/demo/files/ch15-notes.pdf`,
                      'ch15-notes.pdf',
                      'application/pdf',
                    ),
                  ],
                  'Attachments',
                ),
                comments: num(0, { label: 'Class comments' }),
              },
              'Ch.15 reading notes',
            ),
          ],
          'Stream',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'info',
            state_path: 'class_info',
            layout: 'detail',
            label: 'English Literature 10',
          },
          { id: 'upcoming', state_path: 'upcoming', layout: 'list', label: 'Upcoming' },
          {
            id: 'posts',
            state_path: 'posts',
            layout: 'list',
            item_key: 'id',
            primary_action: 'open_post',
            label: 'Stream',
          },
        ],
      },
      actions: {
        open_post: navAction('Open post', GC(origin, 'assignment')),
        go_classwork: navAction('Classwork', GC(origin, 'classwork')),
        go_grades: navAction('Grades', GC(origin, 'grades')),
        go_people: navAction('People', GC(origin, 'people')),
        comment: action('Add class comment', 'mutate', 'safe', {
          input: {
            text: {
              type: 'string',
              description: 'Comment',
              required: true,
              max_length: 2000,
            },
          },
          output: { state_diff: true, changes: ['/state/posts'] },
          idempotent: false,
        }),
      },
      navigation: {
        breadcrumb: [
          { label: 'Classroom', url: GC(origin, 'home') },
          { label: 'English Literature 10', url: GC(origin, 'stream') },
        ],
      },
    }),
  );

  /* ---------- 3. classwork ---------- */
  pages.set(
    'classwork',
    doc({
      id: 'gc_classwork',
      origin,
      path: '/app/gc/classwork',
      title: 'English Literature 10 - Classwork',
      version: 'gc-cw-1',
      state: {
        topics: table(
          {
            id: 'string',
            title: 'string',
            topic: 'enum',
            kind: 'enum',
            assigned: 'datetime',
            due: 'datetime',
            points: 'number',
            status: 'enum',
          },
          [
            [
              'w-essay1215',
              'Essay: chapters 12-15',
              'essays',
              'assignment',
              '2026-09-24T14:02:00+00:00',
              '2026-10-01T23:59:00+00:00',
              100,
              'in_progress',
            ],
            [
              'w-quiz-ch10',
              'Quiz: chapter 10 vocab',
              'quizzes',
              'quiz',
              '2026-09-18T09:00:00+00:00',
              '2026-09-25T23:59:00+00:00',
              20,
              'turned_in',
            ],
            [
              'w-read15',
              'Reading: chapter 15 notes',
              'materials',
              'material',
              '2026-09-22T09:30:00+00:00',
              '2026-09-29T08:00:00+00:00',
              0,
              'assigned',
            ],
            [
              'w-essay0910',
              'Essay: chapters 9-11',
              'essays',
              'assignment',
              '2026-09-03T14:00:00+00:00',
              '2026-09-10T23:59:00+00:00',
              100,
              'graded',
            ],
          ],
          'Classwork',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'work',
            state_path: 'topics',
            layout: 'table',
            primary_action: 'open_item',
            label: 'Classwork',
          },
        ],
      },
      actions: {
        open_item: navAction('Open', GC(origin, 'assignment')),
        back_stream: navAction('Stream', GC(origin, 'stream')),
      },
      navigation: {
        breadcrumb: [
          { label: 'English Literature 10', url: GC(origin, 'stream') },
          { label: 'Classwork', url: GC(origin, 'classwork') },
        ],
      },
    }),
  );

  /* ---------- 4. assignment detail ---------- */
  pages.set(
    'assignment',
    doc({
      id: 'gc_assignment',
      origin,
      path: '/app/gc/assignment',
      title: 'Essay: chapters 12-15',
      version: 'gc-asg-1',
      state: {
        item: obj(
          {
            title: str('Essay: chapters 12-15', 'Title'),
            topic: enumN('essays', ['essays', 'quizzes', 'materials'], undefined, 'Topic'),
            points: num(100, { label: 'Points' }),
            due: datetime('2026-10-01T23:59:00+00:00', 'Due'),
            status: enumN(
              'in_progress',
              ['assigned', 'in_progress', 'turned_in', 'returned', 'graded', 'missing'],
              undefined,
              'Status',
            ),
            instructions: str(
              "Write an analytical essay (800-1000 words) on how the author uses setting to mirror the protagonist's state of mind in chapters 12-15. Cite at least three passages. MLA format. Submit as PDF or Google Doc.",
              'Instructions',
            ),
          },
          'Essay: chapters 12-15',
        ),
        rubric: table(
          {
            criterion: 'string',
            excellent: 'string',
            ok: 'string',
            needs_work: 'string',
            points: 'number',
          },
          [
            [
              'Thesis & argument',
              'Clear, defensible, original',
              'Present but thin',
              'Missing or restates prompt',
              30,
            ],
            ['Textual evidence', '3+ cited passages, analysed', '2 passages', '0-1 passages', 30],
            ['Structure & style', 'Cohesive, MLA clean', 'Some drift', 'Disorganised', 25],
            ['Mechanics', '<5 errors', '5-15 errors', '>15 errors', 15],
          ],
          'Rubric',
        ),
        your_work: obj(
          {
            attachments: arr(
              [
                file(
                  `${origin}/demo/files/essay-draft-v2.pdf`,
                  'essay-draft-v2.pdf',
                  'application/pdf',
                  { size: 96210 },
                ),
              ],
              'Your files',
            ),
            last_saved: datetime('2026-09-26T17:44:00+00:00', 'Last edited'),
            private_comment: str('', 'Private comment to teacher'),
          },
          'Your work',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'item', state_path: 'item', layout: 'detail', label: 'Assignment' },
          { id: 'rubric', state_path: 'rubric', layout: 'table', label: 'Rubric' },
          { id: 'work', state_path: 'your_work', layout: 'detail', label: 'Your work' },
        ],
      },
      actions: {
        submit_work: action('Turn in', 'mutate', 'safe', {
          input: {
            attachment: {
              type: 'file',
              required: true,
              accept_mime: ['application/pdf', 'text/plain'],
              description: 'Your submission file',
            },
            private_comment: {
              type: 'string',
              description: 'Private comment to your teacher (optional)',
              max_length: 500,
            },
          },
          output: { state_diff: true, changes: ['/state/item/value/status', '/state/your_work'] },
          idempotent: true,
        }),
        attach_file: action('Attach file', 'mutate', 'safe', {
          input: {
            file: {
              type: 'file',
              required: true,
              upload: true,
              accept_mime: ['application/pdf', 'text/plain'],
              max_bytes: 10485760,
            },
          },
          output: { state_diff: true, changes: ['/state/your_work'] },
          idempotent: false,
        }),
        back_classwork: navAction('Back to Classwork', GC(origin, 'classwork')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Classwork', url: GC(origin, 'classwork') },
          { label: 'Essay', url: GC(origin, 'assignment') },
        ],
      },
    }),
  );

  /* ---------- 5. grades ---------- */
  pages.set(
    'grades',
    doc({
      id: 'gc_grades',
      origin,
      path: '/app/gc/grades',
      title: 'English Literature 10 - Grades',
      version: 'gc-gr-1',
      state: {
        average: obj(
          {
            class_average: num(884, { label: 'Class average (%)', scale: 1 }),
            work_graded: num(5, { label: 'Assignments graded' }),
            work_outstanding: num(2, { label: 'Outstanding' }),
          },
          'Average',
        ),
        gradebook: table(
          {
            assignment: 'string',
            due: 'date',
            points: 'number',
            scored: 'number',
            status: 'enum',
            returned: 'date',
          },
          [
            ['Essay: chapters 12-15', '2026-10-01', 100, 0, 'in_progress', '2026-01-01'],
            ['Quiz: chapter 10 vocab', '2026-09-25', 20, 18, 'turned_in', '2026-01-01'],
            ['Essay: chapters 9-11', '2026-09-10', 100, 91, 'graded', '2026-09-17'],
            ['Reading response 8', '2026-08-28', 30, 27, 'graded', '2026-09-02'],
            ['Essay: chapters 5-8', '2026-08-21', 100, 84, 'graded', '2026-08-29'],
          ],
          'Gradebook',
        ),
        note: str('Scores of 0 for in-progress work are placeholders until returned.', 'Note'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'avg', state_path: 'average', layout: 'detail', label: 'Average' },
          { id: 'gb', state_path: 'gradebook', layout: 'table', label: 'All work' },
        ],
        components: { note: { type: 'banner', state_path: 'note' } },
      },
      actions: {
        back_stream: navAction('Stream', GC(origin, 'stream')),
      },
      navigation: {
        breadcrumb: [
          { label: 'English Literature 10', url: GC(origin, 'stream') },
          { label: 'Grades', url: GC(origin, 'grades') },
        ],
      },
    }),
  );

  /* ---------- 6. people ---------- */
  pages.set(
    'people',
    doc({
      id: 'gc_people',
      origin,
      path: '/app/gc/people',
      title: 'English Literature 10 - People',
      version: 'gc-ppl-1',
      state: {
        teachers: table(
          { name: 'string', email: 'string' },
          [['Ms Rowan', 'rowan@school.edu']],
          'Teachers',
        ),
        students: table(
          { name: 'string', email: 'string', last_active: 'datetime' },
          [
            ['Ada Osei', 'ada.osei@school.edu', '2026-09-26T18:12:00+00:00'],
            ['Ben Whitaker', 'ben.whitaker@school.edu', '2026-09-26T15:40:00+00:00'],
            ['Chloe Mensah', 'chloe.mensah@school.edu', '2026-09-25T19:02:00+00:00'],
            ['Dev Patel', 'dev.patel@school.edu', '2026-09-26T08:55:00+00:00'],
            ['Eli Novak', 'eli.novak@school.edu', '2026-09-24T21:30:00+00:00'],
          ],
          'Students',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 't', state_path: 'teachers', layout: 'table', label: 'Teachers' },
          { id: 's', state_path: 'students', layout: 'table', label: 'Students' },
        ],
      },
      actions: {
        back_stream: navAction('Stream', GC(origin, 'stream')),
      },
      navigation: {
        breadcrumb: [
          { label: 'English Literature 10', url: GC(origin, 'stream') },
          { label: 'People', url: GC(origin, 'people') },
        ],
      },
    }),
  );

  return pages;
}
