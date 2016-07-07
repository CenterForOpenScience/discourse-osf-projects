export default function() {
  this.resource('projects', function() {
    this.route('show', {path: ':project_guid'});
    this.route('showCategory', {path: '/c/:category/:project_guid'});
    this.route('showParentCategory', {path: '/c/:parent_category/:category/:project_guid'});

    Discourse.Site.currentProp('filters').forEach(filter => {
      this.route('show' + filter.capitalize(), {path: ':project_guid/l/' + filter});
      this.route('showCategory' + filter.capitalize(), {path: '/c/:category/:project_guid/l/' + filter});
      this.route('showParentCategory' + filter.capitalize(), {path: '/c/:parent_category/:category/:project_guid/l/' + filter});
    });
  });
}
