update tasks as task
set
  review_owner_profile_id = coalesce(package.accountable_profile_id, package.owner_id),
  review_requested_at = coalesce(task.review_requested_at, now())
from packages as package
where task.package_id = package.id
  and task.review_owner_profile_id is null
  and coalesce(task.score_final, false) = false
  and (task.review_status = 'requested' or task.status = 'Review')
  and coalesce(package.accountable_profile_id, package.owner_id) is not null;

notify pgrst, 'reload schema';
