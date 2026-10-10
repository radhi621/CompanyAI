// Doctor profile tools.
import { z } from "zod";
import { UserModel } from "../../../models/User";
import { ApiError } from "../../../utils/apiError";
import { doctorsService } from "../../doctors/doctors.service";
import { defineTool, objectIdSchema, optionalBooleanSchema } from "./shared";

export const doctorsTools = {
  create_doctor_profile: defineTool({
    description: "Creates a doctor profile and can link it to an existing doctor user",
    allowedRoles: ["admin"],
    destructive: false,
    argsShape: {
      fullName: "required string",
      specialty: "required string",
      userId: "optional MongoDB ObjectId",
      userEmail: "optional email to link doctor account",
      licenseNumber: "optional string",
      isActive: "optional boolean",
    },
    argsSchema: z
      .object({
        fullName: z.string().min(3).max(120),
        specialty: z.string().min(2).max(80),
        userId: objectIdSchema.optional(),
        userEmail: z.string().email().optional(),
        licenseNumber: z.string().min(3).max(60).optional(),
        isActive: optionalBooleanSchema,
      })
      .refine((value) => !(value.userId && value.userEmail), {
        message: "Provide either userId or userEmail, not both",
      }),
    run: async (args, context) => {
      let resolvedUserId = args.userId;

      if (args.userEmail) {
        const user = await UserModel.findOne({
          email: args.userEmail.trim().toLowerCase(),
        }).select("_id role");

        if (!user) {
          throw new ApiError(404, `User not found for email ${args.userEmail}`);
        }

        if (user.role !== "doctor") {
          throw new ApiError(400, "Linked user must have role doctor");
        }

        resolvedUserId = user._id.toString();
      }

      const doctor = await doctorsService.create({
        actor: context.actor,
        userId: resolvedUserId,
        fullName: args.fullName,
        specialty: args.specialty,
        licenseNumber: args.licenseNumber,
        isActive: args.isActive,
      });

      return {
        doctorId: doctor._id.toString(),
        fullName: doctor.fullName,
        specialty: doctor.specialty,
        licenseNumber: doctor.licenseNumber ?? null,
        userId: doctor.userId ? doctor.userId.toString() : null,
        isActive: doctor.isActive,
      };
    },
  }),
  list_doctors: defineTool({
    description: "Lists doctors in the facility with optional specialty and active filters",
    allowedRoles: ["admin", "doctor", "nurse", "secretary"],
    destructive: false,
    argsShape: {
      specialty: "optional string",
      isActive: "optional boolean",
      limit: "optional number max 100",
    },
    argsSchema: z.object({
      specialty: z.string().min(2).optional(),
      isActive: optionalBooleanSchema,
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
    run: async (args) => {
      const doctors = await doctorsService.list({
        specialty: args.specialty?.trim(),
        isActive: args.isActive,
        limit: args.limit,
      });

      return {
        total: doctors.length,
        doctors,
      };
    },
  }),
};
