/*jshint esversion: 6*/

export default function() {
  this.route('projects', {path: '/forum'}, function() {
    this.route('show', {path: ':project_guid'});
    this.route('showCategory', {path: ':project_guid/c/:category'});
    this.route('showParentCategory', {path: ':project_guid/c/:parent_category/:category'});

    Discourse.Site.currentProp('filters').forEach(filter => {
      this.route('show' + filter.capitalize(), {path: ':project_guid/' + filter});
      this.route('showCategory' + filter.capitalize(), {path: ':project_guid/c/:category/l/' + filter});
      this.route('showParentCategory' + filter.capitalize(), {path: ':project_guid/c/:parent_category/:category/l/' + filter});
    });

    // top
    this.route('top', { path: ':project_guid/top' });
    this.route('topCategory', { path: ':project_guid/c/:category/l/top' });
    //this.route('topCategoryNone', { path: ':project_guid/c/:category/none/l/top' });
    this.route('topParentCategory', { path: ':project_guid/c/:parent_category/:category/l/top' });

    // top by periods
    Discourse.Site.currentProp('periods').forEach(period => {
      this.route('top' + period.capitalize(), { path: ':project_guid/top/' + period });
      this.route('topCategory' + period.capitalize(), { path: ':project_guid/c/:category/l/top/' + period });
      //this.route('topCategoryNone' + period.capitalize(), { path: ':project_guid/c/:category/none/l/top/' + period });
      this.route('topParentCategory' + period.capitalize(), { path: ':project_guid/c/:parent_category/:category/l/top/' + period });
    });
  });
}
