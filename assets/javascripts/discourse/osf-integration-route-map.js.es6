export default function() {
  this.resource('projects', function() {
    this.route('show', {path: ':project_guid'});

    Discourse.Site.currentProp('filters').forEach(filter => {
      this.route('show' + filter.capitalize(), {path: ':project_guid/l/' + filter});
    });
  });
}
