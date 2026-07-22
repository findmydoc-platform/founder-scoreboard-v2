-- The retired Agent API stored no dedicated domain records. Remove only its
-- audit markers; the referenced FounderOps tasks remain untouched.
delete from public.audit_log
where action = 'agent.task_intake.create';
