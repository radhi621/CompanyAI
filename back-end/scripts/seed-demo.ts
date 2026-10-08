/**
 * Demo data for local development.
 *
 *   npm run seed:demo             add demo staff, doctors, patients, notes and appointments
 *   npm run seed:demo -- --remove delete everything this script created
 *
 * Everything it creates is marked (emails on DEMO_EMAIL_DOMAIN, CINs starting with "DEMO",
 * licence numbers starting with "DEMO-"), so it never touches your own data and can be
 * removed cleanly. It uses MONGODB_URI from back-end/.env and refuses to run in production.
 */
import { DateTime } from "luxon";
import { Types } from "mongoose";
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { env } from "../src/config/env";
import { AIRecordModel } from "../src/models/AIRecord";
import { AppointmentModel, type AppointmentStatus } from "../src/models/Appointment";
import { DoctorModel } from "../src/models/Doctor";
import { DoctorScheduleModel } from "../src/models/DoctorSchedule";
import { type IPatientDocument, PatientModel } from "../src/models/Patient";
import { PatientNoteModel } from "../src/models/PatientNote";
import { RefreshTokenModel } from "../src/models/RefreshToken";
import { UserModel } from "../src/models/User";
import type { UserRole } from "../src/types/auth";

const DEMO_EMAIL_DOMAIN = "demo.mediassist.local";
const DEMO_PASSWORD = "DemoPass123";
const TZ = env.APP_TIMEZONE;

const demoEmail = new RegExp(`@${DEMO_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`);

const STAFF: Array<{ key: string; name: string; role: UserRole }> = [
  { key: "admin", name: "Demo Admin", role: "admin" },
  { key: "dr.amrani", name: "Dr Youssef Amrani", role: "doctor" },
  { key: "nurse.bennani", name: "Nadia Bennani", role: "nurse" },
  { key: "secretary.alaoui", name: "Samira Alaoui", role: "secretary" },
];

const PATIENTS = [
  { firstName: "Amina", lastName: "El Fassi", cin: "DEMO1001", dob: "1968-03-14", phone: "0612340001", pathologies: ["Type 2 diabetes", "Hypertension"] },
  { firstName: "Karim", lastName: "Benjelloun", cin: "DEMO1002", dob: "1985-11-02", phone: "0612340002", pathologies: ["Asthma"] },
  { firstName: "Fatima Zahra", lastName: "Tazi", cin: "DEMO1003", dob: "1992-07-21", phone: "0612340003", pathologies: [] },
  { firstName: "Omar", lastName: "Chraibi", cin: "DEMO1004", dob: "1957-01-30", phone: "0612340004", pathologies: ["Atrial fibrillation", "Hypercholesterolemia"] },
  { firstName: "Leila", lastName: "Mansouri", cin: "DEMO1005", dob: "2001-09-09", phone: "0612340005", pathologies: ["Migraine"] },
];

const NOTES: Array<{ patient: number; author: "dr.amrani" | "nurse.bennani"; content: string }> = [
  { patient: 0, author: "nurse.bennani", content: "BP 145/90 at check-in. Fasting glucose 1.62 g/L. Patient reports occasional dizziness." },
  { patient: 0, author: "dr.amrani", content: "Metformin continued. Diet counselling given; recheck HbA1c in 3 months." },
  { patient: 1, author: "nurse.bennani", content: "Peak flow 380 L/min. Inhaler technique reviewed with the patient." },
  { patient: 3, author: "dr.amrani", content: "Irregular pulse on exam. Referred to cardiology (Dr Idrissi) for ECG and anticoagulation review." },
  { patient: 4, author: "nurse.bennani", content: "Reports 3–4 migraine episodes per month, mostly in the morning." },
];

async function removeDemoData(): Promise<void> {
  const demoUsers = await UserModel.find({ email: demoEmail }).select("_id");
  const demoUserIds = demoUsers.map((user) => user._id);
  const demoPatients = await PatientModel.find({ cin: /^DEMO/ }).select("_id");
  const demoPatientIds = demoPatients.map((patient) => patient._id);
  const demoDoctors = await DoctorModel.find({ licenseNumber: /^DEMO-/ }).select("_id");
  const demoDoctorIds = demoDoctors.map((doctor) => doctor._id);

  const results = await Promise.all([
    AppointmentModel.deleteMany({ $or: [{ patientId: { $in: demoPatientIds } }, { doctorId: { $in: demoDoctorIds } }] }),
    PatientNoteModel.deleteMany({ patientId: { $in: demoPatientIds } }),
    AIRecordModel.deleteMany({ patientId: { $in: demoPatientIds } }),
    DoctorScheduleModel.deleteMany({ doctorId: { $in: demoDoctorIds } }),
    RefreshTokenModel.deleteMany({ userId: { $in: demoUserIds } }),
  ]);
  await PatientModel.deleteMany({ _id: { $in: demoPatientIds } });
  await DoctorModel.deleteMany({ _id: { $in: demoDoctorIds } });
  await UserModel.deleteMany({ _id: { $in: demoUserIds } });

  console.log(
    `Removed demo data: ${demoUserIds.length} users, ${demoDoctorIds.length} doctors, ${demoPatientIds.length} patients, ` +
      `${results[0].deletedCount} appointments, ${results[1].deletedCount} notes.`,
  );
}

/** The next `count` weekdays (Mon–Fri) after today, in the clinic timezone. */
function upcomingWeekdays(count: number): DateTime[] {
  const days: DateTime[] = [];
  let cursor = DateTime.now().setZone(TZ).startOf("day");
  while (days.length < count) {
    cursor = cursor.plus({ days: 1 });
    if (cursor.weekday <= 5) {
      days.push(cursor);
    }
  }
  return days;
}

async function seedDemoData(): Promise<void> {
  if (await UserModel.exists({ email: demoEmail })) {
    console.log("Demo data is already present. Run `npm run seed:demo -- --remove` first to recreate it.");
    return;
  }

  // Staff accounts (passwords are hashed by the User model).
  const staff: Record<string, { id: Types.ObjectId; role: UserRole }> = {};
  for (const member of STAFF) {
    const user = await UserModel.create({
      name: member.name,
      email: `${member.key}@${DEMO_EMAIL_DOMAIN}`,
      password: DEMO_PASSWORD,
      role: member.role,
    });
    staff[member.key] = { id: user._id, role: member.role };
  }
  const adminId = staff.admin.id;

  // Doctors and their weekly schedules.
  const amrani = await DoctorModel.create({
    userId: staff["dr.amrani"].id,
    fullName: "Dr Youssef Amrani",
    specialty: "General medicine",
    licenseNumber: "DEMO-GM-001",
    createdBy: adminId,
  });
  const idrissi = await DoctorModel.create({
    fullName: "Dr Salma Idrissi",
    specialty: "Cardiology",
    licenseNumber: "DEMO-CA-002",
    createdBy: adminId,
  });
  await DoctorScheduleModel.create({
    doctorId: amrani._id,
    timezone: TZ,
    slotStepMinutes: 15,
    weeklyAvailability: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
    createdBy: adminId,
  });
  await DoctorScheduleModel.create({
    doctorId: idrissi._id,
    timezone: TZ,
    slotStepMinutes: 15,
    weeklyAvailability: [2, 4].map((dayOfWeek) => ({ dayOfWeek, startTime: "10:00", endTime: "16:00" })),
    createdBy: adminId,
  });

  // Patients, assigned to the demo doctor, nurse and secretary.
  const careTeam = [staff["dr.amrani"].id, staff["nurse.bennani"].id, staff["secretary.alaoui"].id];
  const patients: IPatientDocument[] = [];
  for (const patient of PATIENTS) {
    patients.push(
      await PatientModel.create({
        firstName: patient.firstName,
        lastName: patient.lastName,
        cin: patient.cin,
        phone: patient.phone,
        dateOfBirth: new Date(`${patient.dob}T00:00:00.000Z`),
        pathologies: patient.pathologies,
        assignedStaff: careTeam,
        createdBy: adminId,
      }),
    );
  }

  for (const note of NOTES) {
    await PatientNoteModel.create({
      patientId: patients[note.patient]._id,
      content: note.content,
      createdBy: staff[note.author].id,
      createdByRole: staff[note.author].role,
    });
  }

  // Appointments: upcoming ones inside each doctor's hours, plus two completed past visits.
  const days = upcomingWeekdays(5);
  const cardiologyDay = days.find((day) => day.weekday === 2 || day.weekday === 4) ?? days[0];
  const appointments: Array<{
    day: DateTime;
    time: [number, number];
    minutes: number;
    patient: number;
    doctor: Types.ObjectId;
    reason: string;
    status: AppointmentStatus;
    createdBy: string;
  }> = [
    { day: days[0], time: [9, 30], minutes: 30, patient: 0, doctor: amrani._id, reason: "Diabetes follow-up", status: "confirmed", createdBy: "secretary.alaoui" },
    { day: days[0], time: [11, 0], minutes: 45, patient: 1, doctor: amrani._id, reason: "Asthma review", status: "planned", createdBy: "secretary.alaoui" },
    { day: days[1], time: [14, 0], minutes: 30, patient: 2, doctor: amrani._id, reason: "General check-up", status: "planned", createdBy: "secretary.alaoui" },
    { day: cardiologyDay, time: [10, 30], minutes: 45, patient: 3, doctor: idrissi._id, reason: "ECG and anticoagulation review", status: "confirmed", createdBy: "dr.amrani" },
    { day: days[3], time: [15, 0], minutes: 30, patient: 4, doctor: amrani._id, reason: "Migraine follow-up", status: "planned", createdBy: "secretary.alaoui" },
  ];

  const now = DateTime.now().setZone(TZ);
  const past = [
    { when: now.minus({ days: 14 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }), patient: 0, reason: "Diabetes follow-up" },
    { when: now.minus({ days: 7 }).set({ hour: 11, minute: 30, second: 0, millisecond: 0 }), patient: 3, reason: "Palpitations" },
  ];

  const docs = [
    ...appointments.map((item) => {
      const start = item.day.set({ hour: item.time[0], minute: item.time[1] });
      return {
        patientId: patients[item.patient]._id,
        doctorId: item.doctor,
        startAt: start.toUTC().toJSDate(),
        endAt: start.plus({ minutes: item.minutes }).toUTC().toJSDate(),
        estimatedDurationMinutes: item.minutes,
        reason: item.reason,
        status: item.status,
        source: "manual" as const,
        createdBy: staff[item.createdBy].id,
        createdByRole: staff[item.createdBy].role,
      };
    }),
    ...past.map((item) => ({
      patientId: patients[item.patient]._id,
      doctorId: amrani._id,
      startAt: item.when.toUTC().toJSDate(),
      endAt: item.when.plus({ minutes: 30 }).toUTC().toJSDate(),
      estimatedDurationMinutes: 30,
      reason: item.reason,
      status: "completed" as const,
      notes: "Seen and assessed.",
      source: "manual" as const,
      createdBy: staff["secretary.alaoui"].id,
      createdByRole: "secretary" as const,
    })),
  ];
  await AppointmentModel.insertMany(docs);

  console.log("Demo data created.\n");
  console.log(`  Password for every demo account: ${DEMO_PASSWORD}`);
  for (const member of STAFF) {
    console.log(`  ${member.role.padEnd(9)} ${member.key}@${DEMO_EMAIL_DOMAIN}`);
  }
  console.log(
    `\n  ${patients.length} patients, ${NOTES.length} notes, 2 doctors (with schedules), ${docs.length} appointments.`,
  );
  console.log("  Remove it all with: npm run seed:demo -- --remove");
}

async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data with NODE_ENV=production.");
  }

  await connectDatabase();
  try {
    if (process.argv.includes("--remove")) {
      await removeDemoData();
    } else {
      await seedDemoData();
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
