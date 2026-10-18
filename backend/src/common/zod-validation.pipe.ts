import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType, infer as ZodInfer } from 'zod';

/**
 * Global pipe (Q3): a handler parameter typed with a class made by `zodDto(schema)` is validated and
 * replaced by the parsed value. Parameters without a schema pass through untouched.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const schema = (metadata.metatype as unknown as { zodSchema?: ZodType } | undefined)?.zodSchema;
    if (!schema) return value;
    const result = schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid. Fix the highlighted fields and try again.',
        details: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return result.data;
  }
}

/**
 * Base class carrying a static `zodSchema` the pipe reads. Declare DTOs as classes so decorator metadata
 * points at them (a type alias such as InstanceType<typeof X> erases to Object and skips validation):
 *   class CreateLeadDto extends zodDto(createLeadSchema) {}
 *   create(@Body() body: CreateLeadDto) {}
 */
export function zodDto<TSchema extends ZodType>(schema: TSchema): { new (): ZodInfer<TSchema>; zodSchema: TSchema } {
  class ZodDtoClass {
    static readonly zodSchema = schema;
  }
  return ZodDtoClass as unknown as { new (): ZodInfer<TSchema>; zodSchema: TSchema };
}
