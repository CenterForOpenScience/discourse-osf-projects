import BulkTopicSelection from "discourse/mixins/bulk-topic-selection";

var NavItem, extraNavItemProperties, customNavItemHref;

try {
  NavItem                = require('discourse/models/nav-item').default;
  extraNavItemProperties = require('discourse/models/nav-item').extraNavItemProperties;
  customNavItemHref      = require('discourse/models/nav-item').customNavItemHref;
} catch(e) {
  NavItem = Discourse.NavItem;  // it's not a module in old Discourse code
}

if (extraNavItemProperties) {
  extraNavItemProperties(function(text, opts) {
    if (opts && opts.projectGuid) {
      return {projectGuid: opts.projectGuid};
    } else {
      return {};
    }
  });
}

if (customNavItemHref) {
  customNavItemHref(function(navItem) {
    if (navItem.get('projectGuid')) {
      var name = navItem.get('name');

      if ( !Discourse.Site.currentProp('filters').contains(name) ) {
        return null;
      }

      var path = "/projects/",
          category = navItem.get("category");

      if(category){
        path += "c/";
        path += Discourse.Category.slugFor(category);
        if (navItem.get('noSubcategories')) { path += '/none'; }
        path += "/";
      }

      path += navItem.get('projectGuid') + "/l/";
      return path + name.replace(' ', '-');
    } else {
      return null;
    }
  });
}


export default Ember.Controller.extend(BulkTopicSelection, {
  needs: ["application"],

  project: null,
  list: null,
  canAdminTag: Ember.computed.alias("currentUser.staff"),
  filterMode: null,
  navMode: 'latest',
  loading: false,
  canCreateTopic: false,
  order: 'default',
  ascending: false,
  status: null,
  state: null,
  search: null,
  max_posts: null,
  q: null,

  queryParams: ['order', 'ascending', 'status', 'state', 'search', 'max_posts', 'q'],

  navItems: function() {
    return NavItem.buildList(this.get('category'), {projectGuid: this.get('project.id'), filterMode: this.get('filterMode')});
}.property('category', 'project.id', 'filterMode'),

  categories: function() {
    return Discourse.Category.list();
  }.property(),

  loadMoreTopics() {
    return this.get("list").loadMore();
  },

  _showFooter: function() {
    this.set("controllers.application.showFooter", !this.get("list.canLoadMore"));
  }.observes("list.canLoadMore"),

  actions: {
    changeSort(sortBy) {
      if (sortBy === this.get('order')) {
        this.toggleProperty('ascending');
      } else {
        this.setProperties({ order: sortBy, ascending: false });
      }
      this.send('invalidateModel');
    },

    refresh() {
      const self = this;
      // TODO: this probably doesn't work anymore
      return this.store.findFiltered('topicList', {filter: 'projects/' + this.get('project.id')}).then(function(list) {
        self.set("list", list);
        self.resetSelected();
      });
    },
  }
});
